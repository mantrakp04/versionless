import { publicQueryHttpError } from "@versionless/api/error-policy";
import { executeProjectQuery } from "@versionless/api/lib/clickhouse-query";
import { getHexclaveServerApp } from "@versionless/api/lib/hexclave";
import { executeProjectPgQuery } from "@versionless/api/lib/postgres-query";
import {
  requireProjectAccess,
  type ProjectAccessUser,
} from "@versionless/api/lib/project-access";
import { loadProjectReleases } from "@versionless/api/routers/projects";
import { CURRENT_VERSION, v } from "@versionless/api/versionless";
import { env } from "@versionless/env/server";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
} from "ai";
import { Elysia } from "elysia";
import { z } from "zod";
import { createOpenAICompatible } from "./chat/openai-compatible";
import { buildSystemPrompt } from "./chat/system-prompt";

/** Conversation caps. The assistant is a dashboard sidekick, not a workspace. */
const MAX_MESSAGES = 40;
const MAX_PROMPT_CHARS = 32_000;
const MAX_STEPS = 7;
/** Leave enough room for one guaranteed tool-free rendering step. */
const MAX_RESEARCH_STEPS = 5;
const FINAL_RENDERING_INSTRUCTION = `# Mandatory final rendering step

Tools are now intentionally unavailable because research is complete. Emit the
finished user-facing MDX/React component tree immediately. Do not ask for
another tool call, describe what you would do next, apologize, or return a
progress update. For a dashboard request, the answer must start with
<Dashboard> and contain query-backed <QueryStat>, <QueryChart>, and <QueryTable>
components. Use the verified query shapes and documented schemas you already
have. It is better to render a nonessential widget with an un-preflighted but
schema-correct query than to omit the dashboard.`;
/**
 * Rows handed back to the model per tool call. The query planes already cap at
 * MAX_RESULT_ROWS, but ten thousand rows would bury the context — the model is
 * supposed to aggregate server-side and render the rest through <QueryTable>,
 * which paginates against the same endpoints from the browser.
 */
const MAX_TOOL_ROWS = 200;

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

if (
  env.NODE_ENV === "production" &&
  env.AI_BASE_URL.startsWith("http://localhost")
) {
  console.warn(
    "[chat] AI_BASE_URL still points at localhost; the assistant will fail in production",
  );
}

const uiMessageSchema = z.object({
  id: z.string().max(128).optional(),
  role: z.enum(["system", "user", "assistant"]),
  // Parts are the AI SDK's own union; it is re-validated by
  // convertToModelMessages, so this only bounds size and shape here.
  parts: z
    .array(z.object({ type: z.string() }).loose())
    .min(1)
    .max(64),
});

export const chatRequestSchema = z.object({
  projectId: z.uuid(),
  messages: z.array(uiMessageSchema).min(1).max(MAX_MESSAGES),
  /** Chosen from `GET /v1/chat/models`; falls back to the configured default. */
  model: z.string().min(1).max(200).optional(),
});

const modelsResponseSchema = z.object({
  data: z
    .array(z.object({ id: z.string(), name: z.string().nullish() }).loose())
    .default([]),
});

export interface ChatModelSummary {
  id: string;
  name: string;
}

type ChatRouteDependencies = {
  getUser(request: Request): Promise<ProjectAccessUser | null>;
  authorizeProject: typeof requireProjectAccess;
  loadReleases(
    user: ProjectAccessUser,
    projectId: string,
  ): Promise<{ current: string | null }>;
  listModels(): Promise<ChatModelSummary[]>;
  /**
   * Seam for tests: takes the fully-built streamText arguments and returns the
   * HTTP response, so the route can be exercised without a live model.
   */
  runModel(options: RunModelOptions): Response | Promise<Response>;
  reportError?(error: unknown, context: Record<string, unknown>): void;
  recordTelemetry?(
    route: string,
    status: number,
    latencyMs: number,
  ): Promise<void>;
};

export interface RunModelOptions {
  modelId: string;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
}

/**
 * Total characters of user-authored text across the conversation. Tool results
 * are excluded on purpose: they are ours, already row-capped, and counting them
 * would let a long analysis session lock the user out of asking anything else.
 */
export function promptTextLength(
  messages: z.infer<typeof chatRequestSchema>["messages"],
): number {
  let total = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        total += part.text.length;
      }
    }
  }
  return total;
}

/** Trims a query result to what is useful in a model's context. */
export function capToolRows(rows: unknown): {
  rows: unknown[];
  truncated: boolean;
} {
  const list = Array.isArray(rows) ? rows : [];
  return {
    rows: list.slice(0, MAX_TOOL_ROWS),
    truncated: list.length > MAX_TOOL_ROWS,
  };
}

/**
 * Tool-happy models can otherwise spend every allowed step researching and
 * finish with no user-visible answer. After five rounds, force a tool-free
 * step so the verified SQL is composed into the final React/MDX dashboard.
 */
export function chatStepPolicy(stepNumber: number) {
  return stepNumber >= MAX_RESEARCH_STEPS
    ? { toolChoice: "none" as const, activeTools: [] }
    : undefined;
}

function aiHeaders(): Record<string, string> {
  return env.AI_API_KEY
    ? { authorization: `Bearer ${env.AI_API_KEY}` }
    : {};
}

let modelCache: { models: ChatModelSummary[]; expires: number } | null = null;

/**
 * Reads the OpenAI-standard `GET /models` list. Both plain OpenAI-compatible
 * servers and OpenRouter answer `{data: [{id, …}]}`; OpenRouter adds `name`,
 * so the label prefers it and falls back to the id.
 */
export async function listChatModels(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<ChatModelSummary[]> {
  if (modelCache && modelCache.expires > Date.now()) return modelCache.models;

  const base = env.AI_BASE_URL.replace(/\/$/, "");
  const response = await fetchImpl(`${base}/models`, {
    headers: aiHeaders(),
  });
  if (!response.ok) {
    // The upstream body may carry keys or internal hostnames — never forward it.
    throw new Error(`Model listing failed with status ${response.status}`);
  }
  const parsed = modelsResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Model listing had an unexpected shape");

  const models = parsed.data.data.map((entry) => ({
    id: entry.id,
    name: typeof entry.name === "string" && entry.name.length > 0
      ? entry.name
      : entry.id,
  }));
  modelCache = { models, expires: Date.now() + MODEL_CACHE_TTL_MS };
  return models;
}

export function resetChatModelCache(): void {
  modelCache = null;
}

/**
 * The two query tools, bound to a project the caller has already been
 * authorized for. The tenancy passed to the query planes comes from the
 * authorized project row — never from the request body, and never from
 * anything the model produced.
 */
export function createQueryTools(options: {
  projectId: string;
  teamId: string;
  runClickHouse?: typeof executeProjectQuery;
  runPostgres?: typeof executeProjectPgQuery;
  reportError?(error: unknown, context: Record<string, unknown>): void;
}) {
  const runClickHouse = options.runClickHouse ?? executeProjectQuery;
  const runPostgres = options.runPostgres ?? executeProjectPgQuery;

  /**
   * Tool failures come back as a result rather than a throw so the model can
   * read the message and fix its SQL. The message is the already-sanitized
   * public one; the raw error stays in the server log.
   */
  const failure = (error: unknown, sql: string) => {
    options.reportError?.(error, { projectId: options.projectId, sql });
    return { ok: false as const, error: publicQueryHttpError(error).message };
  };

  return {
    clickhouse_query: tool({
      description:
        "Run a read-only ClickHouse SELECT over this project's telemetry " +
        "(versionless_rollup_daily, otel_logs, otel_traces). Row policies " +
        "already scope every scan to this project. Parameters are named: " +
        "write {days: UInt16} in the SQL and {\"days\": 7} in params.",
      inputSchema: z.object({
        sql: z.string().min(1).max(20_000),
        params: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          )
          .optional(),
      }),
      async execute({ sql, params }) {
        try {
          const { result } = await runClickHouse({
            projectId: options.projectId,
            teamId: options.teamId,
            query: sql,
            params: params ?? {},
            timeoutMs: 10_000,
          });
          const capped = capToolRows(result);
          return { ok: true as const, ...capped };
        } catch (error) {
          return failure(error, sql);
        }
      },
    }),
    postgres_query: tool({
      description:
        "Run a read-only Postgres SELECT over this project's release " +
        "metadata (projects, project_versions, project_sunsets). Row-level " +
        "security already scopes every row to this project. Parameters are " +
        "positional: write $1, $2 and pass an ordered array.",
      inputSchema: z.object({
        sql: z.string().min(1).max(20_000),
        params: z
          .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .max(64)
          .optional(),
      }),
      async execute({ sql, params }) {
        try {
          const { result } = await runPostgres({
            projectId: options.projectId,
            teamId: options.teamId,
            query: sql,
            params: params ?? [],
            timeoutMs: 10_000,
          });
          const capped = capToolRows(result);
          return { ok: true as const, ...capped };
        } catch (error) {
          return failure(error, sql);
        }
      },
    }),
  };
}

const defaultDependencies: ChatRouteDependencies = {
  async getUser(request) {
    return (
      (await getHexclaveServerApp()?.getUser({ tokenStore: request })) ?? null
    );
  },
  authorizeProject: requireProjectAccess,
  loadReleases: (user, projectId) => loadProjectReleases(user, projectId),
  listModels: () => listChatModels(),
  runModel({ modelId, system, messages, tools }) {
    const model = createOpenAICompatible({
      baseURL: env.AI_BASE_URL,
      apiKey: env.AI_API_KEY,
    })(modelId);
    const result = streamText({
      model,
      system,
      messages,
      tools,
      prepareStep: ({ stepNumber }) => {
        const policy = chatStepPolicy(stepNumber);
        return policy
          ? {
              ...policy,
              system: `${system}\n\n${FINAL_RENDERING_INSTRUCTION}`,
            }
          : undefined;
      },
      stopWhen: stepCountIs(MAX_STEPS),
    });
    return result.toUIMessageStreamResponse({
      // Whatever escapes mid-stream reaches the browser as text, so it goes
      // through the same public-copy policy as an HTTP error body.
      onError: (error) => {
        console.error("[chat] stream failed", error);
        return publicQueryHttpError(error).message;
      },
    });
  },
  reportError(error, context) {
    console.error("[chat] request failed", { ...context, error });
  },
  async recordTelemetry(route, status, latencyMs) {
    v.telemetry.emit({
      ts: Date.now(),
      method: route.startsWith("GET") ? "GET" : "POST",
      route,
      adapter: "elysia",
      version: CURRENT_VERSION,
      latencyMs,
      transformCount: 0,
      status,
    });
    // emit() fans out in a microtask; yield once before draining the sinks.
    await Promise.resolve();
    await v.telemetry.flush();
  },
};

/**
 * The dashboard assistant. Authentication picks the trusted project and team;
 * the model only ever sees SQL it wrote itself running against query planes
 * that are already tenant-scoped by ClickHouse row policies and Postgres RLS.
 */
export function createChatApp(
  dependencies: ChatRouteDependencies = defaultDependencies,
) {
  return new Elysia({ name: "versionless-chat" })
    .get("/v1/chat/models", async ({ request, status }) => {
      const startedAt = performance.now();
      let responseStatus = 200;
      try {
        const user = await dependencies.getUser(request);
        if (!user) {
          responseStatus = 401;
          return status(401, { error: "Sign in required" });
        }
        try {
          return { models: await dependencies.listModels() };
        } catch (error) {
          dependencies.reportError?.(error, { route: "chat/models" });
          responseStatus = 503;
          return status(503, {
            error: "The assistant is unavailable right now.",
          });
        }
      } finally {
        await dependencies.recordTelemetry?.(
          "GET /v1/chat/models",
          responseStatus,
          Math.round(performance.now() - startedAt),
        );
      }
    })
    .post(
      "/v1/chat",
      async ({ body, request, status }) => {
        const startedAt = performance.now();
        let responseStatus = 200;
        try {
          const user = await dependencies.getUser(request);
          if (!user) {
            responseStatus = 401;
            return status(401, { error: "Sign in required" });
          }

          if (promptTextLength(body.messages) > MAX_PROMPT_CHARS) {
            responseStatus = 400;
            return status(400, {
              error: "This conversation is too long. Start a new one.",
            });
          }

          const modelId = body.model ?? env.AI_MODEL;
          if (!modelId) {
            responseStatus = 400;
            return status(400, { error: "Pick a model to chat with." });
          }

          try {
            const { project } = await dependencies.authorizeProject(
              user,
              body.projectId,
            );
            const releases = await dependencies.loadReleases(
              user,
              project.id,
            );
            const system = buildSystemPrompt({
              projectName: project.name,
              // A project that has never run `versionless snapshot` has no
              // declared version; say so rather than implying one.
              currentVersion: releases.current ?? "not declared yet",
              today: new Date().toISOString().slice(0, 10),
            });
            return await dependencies.runModel({
              modelId,
              system,
              // The parts union is the SDK's own; zod bounded its size above
              // and convertToModelMessages re-validates the contents.
              messages: await convertToModelMessages(
                body.messages as unknown as UIMessage[],
              ),
              tools: createQueryTools({
                projectId: project.id,
                teamId: project.teamId,
                reportError: dependencies.reportError,
              }),
            });
          } catch (error) {
            dependencies.reportError?.(error, { projectId: body.projectId });
            const publicError = publicQueryHttpError(error);
            responseStatus = publicError.status;
            return status(publicError.status, { error: publicError.message });
          }
        } finally {
          await dependencies.recordTelemetry?.(
            "POST /v1/chat",
            responseStatus,
            Math.round(performance.now() - startedAt),
          );
        }
      },
      { body: chatRequestSchema },
    );
}

export const chatApp = createChatApp();
