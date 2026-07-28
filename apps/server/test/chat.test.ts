import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { ProjectQueryUnavailableError } from "@versionless/api/lib/clickhouse-query";
import { ProjectPgQueryError } from "@versionless/api/lib/postgres-query";
import {
  capToolRows,
  chatStepPolicy,
  createChatApp,
  createQueryTools,
  promptTextLength,
  type RunModelOptions,
} from "../src/chat";

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  teamId: "team_1",
  name: "billing",
  createdAt: new Date("2026-07-23T00:00:00Z"),
  lastSeenAt: new Date("2026-07-23T00:00:00Z"),
};

function chatRequest(body: unknown, authenticated = true) {
  return new Request("http://localhost/v1/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer access-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function ask(text: string) {
  return {
    projectId: project.id,
    model: "test-model",
    messages: [
      { id: "m1", role: "user", parts: [{ type: "text", text }] },
    ],
  };
}

/** Base dependencies with a model stub that just echoes what it was handed. */
function deps(overrides: Partial<Parameters<typeof createChatApp>[0]> = {}) {
  const captured: RunModelOptions[] = [];
  const app = createChatApp({
    getUser: async (req) =>
      req.headers.has("authorization")
        ? { getTeam: async () => ({ id: "team_1" }) }
        : null,
    authorizeProject: async () => ({ project, team: { id: "team_1" } }),
    loadReleases: async () => ({ current: "2026-05-14" }),
    listModels: async () => [{ id: "test-model", name: "Test Model" }],
    runModel: (options) => {
      captured.push(options);
      return new Response("streamed", {
        headers: { "content-type": "text/event-stream" },
      });
    },
    ...overrides,
  });
  return { app, captured };
}

describe("POST /v1/chat", () => {
  test("builds a project-scoped prompt and tools for an authorized caller", async () => {
    const { app, captured } = deps();

    const response = await app.handle(
      chatRequest(ask("what is my p95 this week?")),
    );

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.modelId).toBe("test-model");
    expect(call.system).toContain("billing");
    expect(call.system).toContain("2026-05-14");
    expect(call.system).toContain(
      "clickhouse_query` and `postgres_query` are your private research",
    );
    expect(call.system).toContain(
      "Every displayed metric must come from a live component",
    );
    expect(call.system).toContain("The renderer accepts declarative MDX only");
    expect(call.system).toContain(
      "Braced component props may contain only static JSON-like literals",
    );
    expect(call.system).toContain("<Dashboard>");
    expect(call.system).toContain('source="postgres"');
    expect(Object.keys(call.tools).sort()).toEqual([
      "clickhouse_query",
      "postgres_query",
    ]);
    expect(call.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "what is my p95 this week?" }] },
    ]);
  });

  test("says the version is undeclared rather than inventing one", async () => {
    const { app, captured } = deps({
      loadReleases: async () => ({ current: null }),
    });

    await app.handle(chatRequest(ask("what version am I on?")));

    expect(captured[0]!.system).toContain("not declared yet");
  });

  test("fails closed before the model runs when signed out or forbidden", async () => {
    let ran = false;
    const { app } = deps({
      getUser: async (req) =>
        req.headers.has("authorization")
          ? { getTeam: async () => null }
          : null,
      authorizeProject: async () => {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      },
      runModel: () => {
        ran = true;
        return new Response("never");
      },
    });

    expect(
      (await app.handle(chatRequest(ask("hi"), false))).status,
    ).toBe(401);
    const forbidden = await app.handle(chatRequest(ask("hi")));
    expect(forbidden.status).toBe(403);
    // NODE_ENV=test scrubs like production: policy copy, not the raw message.
    expect(await forbidden.json()).toEqual({
      error: "You do not have access to this resource.",
    });
    expect(ran).toBe(false);
  });

  test("rejects an oversized conversation before spending a model call", async () => {
    let ran = false;
    const { app } = deps({
      runModel: () => {
        ran = true;
        return new Response("never");
      },
    });

    const response = await app.handle(
      chatRequest({
        projectId: project.id,
        model: "test-model",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "x".repeat(40_000) }],
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "This conversation is too long. Start a new one.",
    });
    expect(ran).toBe(false);
  });
});

describe("GET /v1/chat/models", () => {
  function modelsRequest(authenticated = true) {
    return new Request("http://localhost/v1/chat/models", {
      headers: authenticated ? { authorization: "Bearer access-token" } : {},
    });
  }

  test("lists the upstream models for an authenticated caller", async () => {
    const { app } = deps();
    const response = await app.handle(modelsRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [{ id: "test-model", name: "Test Model" }],
    });
  });

  test("requires sign-in", async () => {
    const { app } = deps();
    expect((await app.handle(modelsRequest(false))).status).toBe(401);
  });

  test("never forwards the upstream failure to the browser", async () => {
    const logged: unknown[] = [];
    const { app } = deps({
      listModels: async () => {
        throw new Error(
          "401 from https://openrouter.ai/api/v1 with key sk-or-v1-secret",
        );
      },
      reportError: (error) => logged.push(error),
    });

    const response = await app.handle(modelsRequest());
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("The assistant is unavailable right now.");
    expect(body.error).not.toContain("sk-or-v1-secret");
    expect(body.error).not.toContain("openrouter.ai");
    // The diagnostic still reaches the server log.
    expect(logged).toHaveLength(1);
  });
});

describe("query tools", () => {
  test("passes only the authorized tenancy into both query planes", async () => {
    const clickhouse: unknown[] = [];
    const postgres: unknown[] = [];
    const tools = createQueryTools({
      projectId: project.id,
      teamId: project.teamId,
      runClickHouse: async (input) => {
        clickhouse.push(input);
        return { result: [{ requests: 5 }], queryId: "q1" };
      },
      runPostgres: async (input) => {
        postgres.push(input);
        return { result: [{ version: "2026-05-14" }], queryId: "q2" };
      },
    });

    const options = {} as never;
    const chResult = await tools.clickhouse_query.execute!(
      { sql: "SELECT sum(requests) AS requests FROM versionless_rollup_daily WHERE day >= today() - {days: UInt16}", params: { days: 7 } },
      options,
    );
    const pgResult = await tools.postgres_query.execute!(
      { sql: "SELECT version FROM project_versions ORDER BY version DESC LIMIT $1", params: [5] },
      options,
    );

    expect(chResult).toEqual({
      ok: true,
      rows: [{ requests: 5 }],
      truncated: false,
    });
    expect(pgResult).toEqual({
      ok: true,
      rows: [{ version: "2026-05-14" }],
      truncated: false,
    });
    expect(clickhouse).toEqual([
      {
        projectId: project.id,
        teamId: "team_1",
        query:
          "SELECT sum(requests) AS requests FROM versionless_rollup_daily WHERE day >= today() - {days: UInt16}",
        params: { days: 7 },
        timeoutMs: 10_000,
      },
    ]);
    expect(postgres).toEqual([
      {
        projectId: project.id,
        teamId: "team_1",
        query:
          "SELECT version FROM project_versions ORDER BY version DESC LIMIT $1",
        params: [5],
        timeoutMs: 10_000,
      },
    ]);
  });

  test("returns a public message the model can act on, and logs the rest", async () => {
    const logged: Array<{ error: unknown; context: Record<string, unknown> }> =
      [];
    const tools = createQueryTools({
      projectId: project.id,
      teamId: project.teamId,
      runClickHouse: async () => {
        throw new ProjectQueryUnavailableError(
          'user "versionless_query" is missing at clickhouse.internal:8123',
        );
      },
      runPostgres: async () => {
        throw new ProjectPgQueryError(
          "Only SELECT and WITH queries are allowed on this endpoint.",
        );
      },
      reportError: (error, context) => logged.push({ error, context }),
    });

    const options = {} as never;
    const unavailable = (await tools.clickhouse_query.execute!(
      { sql: "SELECT 1" },
      options,
    )) as { ok: boolean; error: string };
    const rejected = (await tools.postgres_query.execute!(
      { sql: "DELETE FROM projects" },
      options,
    )) as { ok: boolean; error: string };

    // NODE_ENV=test scrubs like production: no users, hosts, or ports.
    expect(unavailable.ok).toBe(false);
    expect(unavailable.error).toBe(
      "This service is temporarily unavailable. Please try again shortly.",
    );
    expect(unavailable.error).not.toContain("clickhouse.internal");
    // A bad-SQL diagnostic is already public by construction, so the model
    // gets it verbatim and can fix its own query.
    expect(rejected).toEqual({
      ok: false,
      error: "Only SELECT and WITH queries are allowed on this endpoint.",
    });
    expect(logged).toHaveLength(2);
    expect(logged[0]!.context).toMatchObject({ projectId: project.id });
  });
});

describe("helpers", () => {
  test("forces a final answer after the bounded research rounds", () => {
    expect(chatStepPolicy(4)).toBeUndefined();
    expect(chatStepPolicy(5)).toEqual({
      toolChoice: "none",
      activeTools: [],
    });
  });

  test("counts only user-authored text toward the prompt cap", () => {
    expect(
      promptTextLength([
        { role: "user", parts: [{ type: "text", text: "abcd" }] },
        {
          role: "assistant",
          parts: [
            { type: "text", text: "ef" },
            // Tool traffic is ours and already row-capped; a long analysis
            // session must not lock the user out of asking anything else.
            { type: "tool-clickhouse_query", output: "x".repeat(5_000) },
          ],
        },
      ]),
    ).toBe(6);
  });

  test("caps tool rows and says when it did", () => {
    const many = Array.from({ length: 250 }, (_, index) => ({ index }));
    expect(capToolRows(many)).toEqual({
      rows: many.slice(0, 200),
      truncated: true,
    });
    expect(capToolRows([{ a: 1 }])).toEqual({
      rows: [{ a: 1 }],
      truncated: false,
    });
    expect(capToolRows(null)).toEqual({ rows: [], truncated: false });
  });
});
