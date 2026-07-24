import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
  ProjectQueryError,
  ProjectQueryUnavailableError,
} from "@versionless/api/lib/clickhouse-query";
import { createProjectQueryApp } from "../src/query";

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  teamId: "team_1",
  name: "billing",
  createdAt: new Date("2026-07-23T00:00:00Z"),
  lastSeenAt: new Date("2026-07-23T00:00:00Z"),
};

function request(body: unknown, authenticated = true) {
  return new Request("http://localhost/v1/query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer access-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/query", () => {
  test("authenticates the project and passes only trusted tenancy to SQL", async () => {
    const calls: unknown[] = [];
    const telemetry: Array<{ status: number; latencyMs: number }> = [];
    const app = createProjectQueryApp({
      getUser: async (req) =>
        req.headers.has("authorization")
          ? { getTeam: async () => ({ id: "team_1" }) }
          : null,
      authorizeProject: async () => ({
        project,
        team: { id: "team_1" },
      }),
      executeQuery: async (input) => {
        calls.push(input);
        return { result: [{ total: 1 }], queryId: "query_1" };
      },
      recordTelemetry: async (status, latencyMs) => {
        telemetry.push({ status, latencyMs });
      },
    });

    const response = await app.handle(
      request({
        projectId: project.id,
        query: "SELECT count() AS total FROM otel_logs",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: [{ total: 1 }],
      query_id: "query_1",
    });
    expect(calls).toEqual([
      {
        projectId: project.id,
        teamId: "team_1",
        query: "SELECT count() AS total FROM otel_logs",
        params: {},
        timeoutMs: 10_000,
      },
    ]);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]!.status).toBe(200);
    expect(telemetry[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("fails closed before query execution when signed out or forbidden", async () => {
    let executed = false;
    const app = createProjectQueryApp({
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
      executeQuery: async () => {
        executed = true;
        return { result: [], queryId: "never" };
      },
    });

    expect(
      (await app.handle(request({ projectId: project.id, query: "SELECT 1" }, false)))
        .status,
    ).toBe(401);
    const forbidden = await app.handle(
      request({ projectId: project.id, query: "SELECT 1" }),
    );
    expect(forbidden.status).toBe(403);
    // NODE_ENV=test scrubs like production: policy copy, not the raw message.
    expect(await forbidden.json()).toEqual({
      error: "You do not have access to this resource.",
    });
    expect(executed).toBe(false);
  });

  test("keeps already-public query diagnostics for the caller", async () => {
    const app = createProjectQueryApp({
      getUser: async () => ({ getTeam: async () => ({ id: "team_1" }) }),
      authorizeProject: async () => ({
        project,
        team: { id: "team_1" },
      }),
      executeQuery: async () => {
        throw new ProjectQueryError("Syntax error near SELECT");
      },
    });

    const response = await app.handle(
      request({ projectId: project.id, query: "SELEC 1" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Syntax error near SELECT",
    });
  });

  test("reports query infrastructure failures as unavailable without diagnostics", async () => {
    const diagnostics: unknown[] = [];
    const app = createProjectQueryApp({
      getUser: async () => ({ getTeam: async () => ({ id: "team_1" }) }),
      authorizeProject: async () => ({
        project,
        team: { id: "team_1" },
      }),
      executeQuery: async () => {
        throw new ProjectQueryUnavailableError(
          "ClickHouse unavailable — set CLICKHOUSE_URL and run `bun db:start`",
        );
      },
      reportError: (error, projectId) => {
        diagnostics.push({ error, projectId });
      },
    });

    const response = await app.handle(
      request({ projectId: project.id, query: "SELECT 1" }),
    );
    expect(response.status).toBe(503);
    // NODE_ENV=test scrubs like production: no operator commands or
    // infrastructure details cross the HTTP boundary.
    expect(await response.json()).toEqual({
      error: "This service is temporarily unavailable. Please try again shortly.",
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ projectId: project.id });
  });
});
