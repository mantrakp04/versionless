import { describe, expect, test } from "bun:test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { createOpenAICompatible } from "../src/chat/openai-compatible";

function sseResponse(frames: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) {
          controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const parts: LanguageModelV3StreamPart[] = [];
  for await (const part of stream as unknown as AsyncIterable<LanguageModelV3StreamPart>) {
    parts.push(part);
  }
  return parts;
}

function textPrompt(text: string) {
  return [{ role: "user" as const, content: [{ type: "text" as const, text }] }];
}

describe("the OpenAI-compatible provider", () => {
  test("streams text deltas and reports usage and finish reason", async () => {
    let seen: { url: string; body: Record<string, unknown>; auth?: string } | undefined;
    const model = createOpenAICompatible({
      baseURL: "https://models.example/v1/",
      apiKey: "test-key",
      fetch: (async (url: string, init: RequestInit) => {
        seen = {
          url: String(url),
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
          auth: new Headers(init.headers).get("authorization") ?? undefined,
        };
        return sseResponse([
          '{"id":"c1","choices":[{"delta":{"content":"p95 is "}}]}',
          '{"id":"c1","choices":[{"delta":{"content":"412ms"}}]}',
          '{"id":"c1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":7}}',
        ]);
      }) as unknown as typeof fetch,
    })("some-model");

    const { stream } = await model.doStream({ prompt: textPrompt("p95?") });
    const parts = await collect(stream);

    // A trailing slash on baseURL must not produce a doubled path segment.
    expect(seen?.url).toBe("https://models.example/v1/chat/completions");
    expect(seen?.auth).toBe("Bearer test-key");
    expect(seen?.body.stream).toBe(true);
    expect(parts.map((part) => part.type)).toEqual([
      "stream-start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ]);
    expect(
      parts
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta)
        .join(""),
    ).toBe("p95 is 412ms");
    const finish = parts.at(-1);
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
    });
    expect(finish?.type === "finish" && finish.usage.inputTokens.total).toBe(30);
    expect(finish?.type === "finish" && finish.usage.outputTokens.total).toBe(7);
  });

  test("reassembles a tool call whose name and arguments arrive in fragments", async () => {
    const model = createOpenAICompatible({
      baseURL: "https://models.example/v1",
      fetch: (async () =>
        sseResponse([
          // The name lands on the first fragment, the arguments across three,
          // and the id only once — the shape every OpenAI-compatible server emits.
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"clickhouse_query","arguments":""}}]}}]}',
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"sql\\":"}}]}}]}',
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"SELECT 1\\"}"}}]}}]}',
          '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        ])) as unknown as typeof fetch,
    })("some-model");

    const { stream } = await model.doStream({ prompt: textPrompt("count rows") });
    const parts = await collect(stream);

    const call = parts.find((part) => part.type === "tool-call");
    expect(call).toEqual({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "clickhouse_query",
      input: '{"sql":"SELECT 1"}',
    });
    // The SDK needs start/delta/end around the call to render live tool progress.
    expect(parts.map((part) => part.type)).toEqual([
      "stream-start",
      "tool-input-start",
      "tool-input-delta",
      "tool-input-delta",
      "tool-input-end",
      "tool-call",
      "finish",
    ]);
    expect(parts.at(-1)).toMatchObject({
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
    });
  });

  test("emits an object-shaped input when a tool call carries no arguments", async () => {
    const model = createOpenAICompatible({
      baseURL: "https://models.example/v1",
      fetch: (async () =>
        sseResponse([
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_versions"}}]}}]}',
          '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        ])) as unknown as typeof fetch,
    })("some-model");

    const { stream } = await model.doStream({ prompt: textPrompt("versions") });
    const call = (await collect(stream)).find((part) => part.type === "tool-call");
    // "" would fail JSON parsing and the tool would never run.
    expect(call?.type === "tool-call" && call.input).toBe("{}");
  });

  test("passes tools and tool choice through in the OpenAI wire shape", async () => {
    let body: Record<string, unknown> | undefined;
    const model = createOpenAICompatible({
      baseURL: "https://models.example/v1",
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return sseResponse(['{"choices":[{"delta":{},"finish_reason":"stop"}]}']);
      }) as unknown as typeof fetch,
    })("some-model");

    await model.doStream({
      prompt: textPrompt("hi"),
      tools: [
        {
          type: "function",
          name: "postgres_query",
          description: "Read release metadata",
          inputSchema: { type: "object", properties: { sql: { type: "string" } } },
        },
      ],
      toolChoice: { type: "auto" },
      temperature: 0.2,
    });

    expect(body?.tools).toEqual([
      {
        type: "function",
        function: {
          name: "postgres_query",
          description: "Read release metadata",
          parameters: { type: "object", properties: { sql: { type: "string" } } },
        },
      },
    ]);
    expect(body?.tool_choice).toBe("auto");
    expect(body?.temperature).toBe(0.2);
  });

  test("flattens assistant tool calls and tool results back onto the wire", async () => {
    let body: { messages: Array<Record<string, unknown>> } | undefined;
    const model = createOpenAICompatible({
      baseURL: "https://models.example/v1",
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as typeof body;
        return sseResponse(['{"choices":[{"delta":{},"finish_reason":"stop"}]}']);
      }) as unknown as typeof fetch,
    })("some-model");

    await model.doStream({
      prompt: [
        { role: "system", content: "You are an analyst." },
        { role: "user", content: [{ type: "text", text: "how many?" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "clickhouse_query",
              input: { sql: "SELECT 1" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "clickhouse_query",
              output: { type: "json", value: [{ total: 4 }] },
            },
          ],
        },
      ],
    });

    expect(body?.messages).toEqual([
      { role: "system", content: "You are an analyst." },
      { role: "user", content: "how many?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "clickhouse_query", arguments: '{"sql":"SELECT 1"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '[{"total":4}]' },
    ]);
  });

  test("surfaces a mid-stream error frame instead of silently ending", async () => {
    const model = createOpenAICompatible({
      baseURL: "https://models.example/v1",
      fetch: (async () =>
        sseResponse([
          '{"choices":[{"delta":{"content":"partial"}}]}',
          '{"error":{"message":"upstream capacity exceeded"}}',
        ])) as unknown as typeof fetch,
    })("some-model");

    const parts = await collect((await model.doStream({ prompt: textPrompt("hi") })).stream);
    expect(parts.some((part) => part.type === "error")).toBe(true);
    expect(parts.at(-1)).toMatchObject({
      type: "finish",
      finishReason: { unified: "error" },
    });
  });
});
