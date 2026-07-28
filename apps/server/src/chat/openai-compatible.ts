import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  generateId,
  postJsonToApi,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod";

/**
 * A minimal OpenAI `/chat/completions` provider implementing the AI SDK's
 * `LanguageModelV3` interface, covering exactly what the dashboard assistant
 * uses: streamed text, streamed tool calls, and usage. It is deliberately not a
 * general-purpose provider — no images, audio, or reasoning parts — because the
 * chat route only ever sends text and tool results.
 *
 * The wire format is the one every OpenAI-compatible server implements, so the
 * same code reaches a local endpoint in development and OpenRouter in
 * production by changing `baseURL` alone.
 */
export interface OpenAICompatibleSettings {
  /** Root of the API including the version segment, e.g. `https://…/v1`. */
  baseURL: string;
  apiKey?: string;
  /** Extra headers — OpenRouter's attribution headers go here. */
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

const usageSchema = z
  .object({
    prompt_tokens: z.number().nullish(),
    completion_tokens: z.number().nullish(),
    total_tokens: z.number().nullish(),
  })
  .nullish();

const toolCallDeltaSchema = z.object({
  index: z.number(),
  id: z.string().nullish(),
  type: z.literal("function").nullish(),
  function: z
    .object({ name: z.string().nullish(), arguments: z.string().nullish() })
    .nullish(),
});

const chunkSchema = z.union([
  // Some gateways emit a terminal `{"error": …}` frame on a 200 stream rather
  // than failing the request, so it has to be part of the chunk union — and
  // first, because every field of the success branch is optional and would
  // otherwise match an error frame as an empty chunk.
  z.object({ error: z.object({ message: z.string() }).loose() }),
  z.object({
    id: z.string().nullish(),
    model: z.string().nullish(),
    created: z.number().nullish(),
    choices: z
      .array(
        z.object({
          delta: z
            .object({
              content: z.string().nullish(),
              tool_calls: z.array(toolCallDeltaSchema).nullish(),
            })
            .nullish(),
          finish_reason: z.string().nullish(),
        }),
      )
      .nullish(),
    usage: usageSchema,
  }),
]);

const errorSchema = z.object({
  error: z.union([
    z.object({ message: z.string(), type: z.string().nullish() }),
    z.string(),
  ]),
});

const failedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: zodSchema(errorSchema),
  errorToMessage: (data) =>
    typeof data.error === "string" ? data.error : data.error.message,
});

/**
 * Maps the OpenAI finish reason onto the SDK's unified vocabulary. `raw` keeps
 * the server's own word so a provider-specific reason is still observable.
 */
function mapFinishReason(reason: string | null | undefined): LanguageModelV3FinishReason {
  const unified = (() => {
    switch (reason) {
      case "stop":
        return "stop" as const;
      case "length":
        return "length" as const;
      case "content_filter":
        return "content-filter" as const;
      case "tool_calls":
      case "function_call":
        return "tool-calls" as const;
      default:
        return "other" as const;
    }
  })();
  return { unified, raw: reason ?? undefined };
}

function mapUsage(
  usage: z.infer<typeof usageSchema>,
): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage?.prompt_tokens ?? undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage?.completion_tokens ?? undefined,
      text: undefined,
      reasoning: undefined,
    },
  };
}

/** Flattens the SDK's structured prompt into OpenAI chat messages. */
function toChatMessages(prompt: LanguageModelV3Prompt): unknown[] {
  const messages: unknown[] = [];
  for (const message of prompt) {
    switch (message.role) {
      case "system":
        messages.push({ role: "system", content: message.content });
        break;
      case "user":
        messages.push({
          role: "user",
          content: message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
        });
        break;
      case "assistant": {
        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        const toolCalls = message.content
          .filter((part) => part.type === "tool-call")
          .map((part) => ({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments: JSON.stringify(part.input ?? {}),
            },
          }));
        messages.push({
          role: "assistant",
          content: text.length > 0 ? text : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
        break;
      }
      case "tool":
        for (const part of message.content) {
          if (part.type !== "tool-result") continue;
          const output = part.output;
          messages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content:
              output.type === "text" || output.type === "error-text"
                ? output.value
                : JSON.stringify("value" in output ? output.value : output),
          });
        }
        break;
    }
  }
  return messages;
}

function toRequestBody(
  modelId: string,
  options: LanguageModelV3CallOptions,
  stream: boolean,
): { body: Record<string, unknown>; warnings: SharedV3Warning[] } {
  const warnings: SharedV3Warning[] = [];
  const tools = (options.tools ?? []).filter(
    (tool) => tool.type === "function",
  );
  for (const tool of options.tools ?? []) {
    if (tool.type !== "function") {
      warnings.push({
        type: "unsupported",
        feature: "provider-defined-tools",
        details: `Tool "${tool.name}" was dropped: only function tools are supported.`,
      });
    }
  }

  return {
    warnings,
    body: {
      model: modelId,
      messages: toChatMessages(options.prompt),
      stream,
      // Ask for a usage frame on the stream; servers that don't know the
      // option ignore it, and usage simply stays undefined.
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(options.maxOutputTokens === undefined
        ? {}
        : { max_tokens: options.maxOutputTokens }),
      ...(options.temperature === undefined
        ? {}
        : { temperature: options.temperature }),
      ...(options.topP === undefined ? {} : { top_p: options.topP }),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.stopSequences === undefined
        ? {}
        : { stop: options.stopSequences }),
      ...(options.frequencyPenalty === undefined
        ? {}
        : { frequency_penalty: options.frequencyPenalty }),
      ...(options.presencePenalty === undefined
        ? {}
        : { presence_penalty: options.presencePenalty }),
      ...(options.responseFormat?.type === "json"
        ? {
            response_format: options.responseFormat.schema
              ? {
                  type: "json_schema",
                  json_schema: {
                    name: options.responseFormat.name ?? "response",
                    schema: options.responseFormat.schema,
                  },
                }
              : { type: "json_object" },
          }
        : {}),
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
      ...(options.toolChoice === undefined
        ? {}
        : {
            tool_choice:
              options.toolChoice.type === "tool"
                ? {
                    type: "function",
                    function: { name: options.toolChoice.toolName },
                  }
                : options.toolChoice.type,
          }),
    },
  };
}

const generateSchema = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullish(),
        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              function: z.object({ name: z.string(), arguments: z.string() }),
            }),
          )
          .nullish(),
      }),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: usageSchema,
});

class OpenAICompatibleChatModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "openai-compatible";
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(
    readonly modelId: string,
    private readonly settings: OpenAICompatibleSettings,
  ) {}

  private get url() {
    return `${this.settings.baseURL.replace(/\/$/, "")}/chat/completions`;
  }

  private headers(callHeaders: LanguageModelV3CallOptions["headers"]) {
    return combineHeaders(
      {
        ...(this.settings.apiKey
          ? { authorization: `Bearer ${this.settings.apiKey}` }
          : {}),
        ...this.settings.headers,
      },
      callHeaders ?? {},
    );
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    const { body, warnings } = toRequestBody(this.modelId, options, false);
    const { value, responseHeaders } = await postJsonToApi({
      url: this.url,
      headers: this.headers(options.headers),
      body,
      failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        zodSchema(generateSchema),
      ),
      abortSignal: options.abortSignal,
      fetch: this.settings.fetch,
    });

    const choice = value.choices[0];
    const content: LanguageModelV3Content[] = [];
    if (choice?.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }
    for (const call of choice?.message.tool_calls ?? []) {
      content.push({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.function.name,
        input: call.function.arguments,
      });
    }

    return {
      content,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: mapUsage(value.usage),
      warnings,
      response: { id: value.id ?? undefined, modelId: value.model ?? undefined, headers: responseHeaders },
    };
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const { body, warnings } = toRequestBody(this.modelId, options, true);
    const { value: response, responseHeaders } = await postJsonToApi({
      url: this.url,
      headers: this.headers(options.headers),
      body,
      failedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        zodSchema(chunkSchema),
      ),
      abortSignal: options.abortSignal,
      fetch: this.settings.fetch,
    });

    // Tool arguments arrive as a stream of fragments keyed by index; the id and
    // name usually come only on the first fragment, so both are latched here.
    const toolCalls = new Map<
      number,
      { id: string; name: string; input: string; started: boolean }
    >();
    let textId: string | undefined;
    let finishReason = mapFinishReason(undefined);
    let usage = mapUsage(undefined);

    const stream = response.pipeThrough(
      new TransformStream<
        { success: boolean; value?: unknown; error?: unknown },
        LanguageModelV3StreamPart
      >({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings });
        },
        transform(chunk, controller) {
          if (!chunk.success) {
            controller.enqueue({ type: "error", error: chunk.error });
            return;
          }
          const parsed = chunk.value as z.infer<typeof chunkSchema>;
          if ("error" in parsed) {
            controller.enqueue({ type: "error", error: parsed.error });
            finishReason = { unified: "error", raw: undefined };
            return;
          }
          if (parsed.usage) usage = mapUsage(parsed.usage);

          const choice = parsed.choices?.[0];
          if (!choice) return;

          const text = choice.delta?.content;
          if (text) {
            if (textId === undefined) {
              textId = parsed.id ?? generateId();
              controller.enqueue({ type: "text-start", id: textId });
            }
            controller.enqueue({ type: "text-delta", id: textId, delta: text });
          }

          for (const delta of choice.delta?.tool_calls ?? []) {
            const existing = toolCalls.get(delta.index);
            const call = existing ?? {
              id: delta.id ?? generateId(),
              name: delta.function?.name ?? "",
              input: "",
              started: false,
            };
            if (!existing) toolCalls.set(delta.index, call);
            if (delta.id) call.id = delta.id;
            if (delta.function?.name) call.name = delta.function.name;

            // The SDK needs a name before it can announce the call, and some
            // servers send an empty first fragment carrying only the index.
            if (!call.started && call.name.length > 0) {
              call.started = true;
              controller.enqueue({
                type: "tool-input-start",
                id: call.id,
                toolName: call.name,
              });
            }
            const args = delta.function?.arguments;
            if (args) {
              call.input += args;
              if (call.started) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: call.id,
                  delta: args,
                });
              }
            }
          }

          if (choice.finish_reason) {
            finishReason = mapFinishReason(choice.finish_reason);
          }
        },
        flush(controller) {
          if (textId !== undefined) {
            controller.enqueue({ type: "text-end", id: textId });
          }
          for (const call of toolCalls.values()) {
            if (!call.started) continue;
            controller.enqueue({ type: "tool-input-end", id: call.id });
            controller.enqueue({
              type: "tool-call",
              toolCallId: call.id,
              toolName: call.name,
              // An empty fragment stream still has to parse as an object, or
              // the SDK rejects the call before the tool ever runs.
              input: call.input.length > 0 ? call.input : "{}",
            });
          }
          controller.enqueue({ type: "finish", finishReason, usage });
        },
      }),
    );

    return { stream, response: { headers: responseHeaders } };
  }
}

/**
 * Builds a model factory bound to one OpenAI-compatible endpoint, mirroring the
 * shape of the official providers: `provider(modelId)` returns the model.
 */
export function createOpenAICompatible(settings: OpenAICompatibleSettings) {
  return (modelId: string): LanguageModelV3 =>
    new OpenAICompatibleChatModel(modelId, settings);
}
