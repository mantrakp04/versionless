import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
  ProjectPgQueryError,
  ProjectPgQueryUnavailableError,
} from "@versionless/api/lib/postgres-query";
import { createProjectPgQueryApp } from "../src/pg-query";

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  teamId: "team_1",
  name: "billing",
  createdAt: new Date("2026-07-23T00:00:00Z"),
  lastSeenAt: new Date("2026-07-23T00:00:00Z"),
};

function request(body: unknown, authenticated = true) {
  return new Request("http://localhost/v1/pg-query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer access-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/pg-query", () => {
  test("authenticates the project and passes only trusted tenancy to SQL", async () => {
    const calls: unknown[] = [];
    const telemetry: Array<{ status: number; latencyMs: number }> = [];
    const app = createProjectPgQueryApp({
      getUser: async (req) =>
        req.headers.has("authorization")
          ? { getTeam: async () => ({ id: "team_1" }) }
          : null,
      authorizeProject: async () => ({ project, team: { id: "team_1" } }),
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
        query: "SELECT count(*) AS total FROM project_versions",
        params: ["2026-07-24"],
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
        query: "SELECT count(*) AS total FROM project_versions",
        params: ["2026-07-24"],
        timeoutMs: 10_000,
      },
    ]);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]!.status).toBe(200);
  });

  test("takes tenancy from the authorized project, never from the body", async () => {
    const calls: Array<{ projectId: string; teamId: string }> = [];
    const app = createProjectPgQueryApp({
      getUser: async () => ({ getTeam: async () => ({ id: "team_1" }) }),
      // A caller who is a member of project A cannot borrow its authorization
      // to read project B: the authorized row supplies both GUC values.
      authorizeProject: async () => ({ project, team: { id: "team_1" } }),
      executeQuery: async (input) => {
        calls.push({ projectId: input.projectId, teamId: input.teamId });
        return { result: [], queryId: "query_1" };
      },
    });

    await app.handle(
      request({
        projectId: "22222222-2222-4222-8222-222222222222",
        query: "SELECT * FROM projects",
      }),
    );

    expect(calls).toEqual([{ projectId: project.id, teamId: "team_1" }]);
  });

  test("fails closed before query execution when signed out or forbidden", async () => {
    let executed = false;
    const app = createProjectPgQueryApp({
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
      (
        await app.handle(
          request({ projectId: project.id, query: "SELECT 1" }, false),
        )
      ).status,
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
    const app = createProjectPgQueryApp({
      getUser: async () => ({ getTeam: async () => ({ id: "team_1" }) }),
      authorizeProject: async () => ({ project, team: { id: "team_1" } }),
      executeQuery: async () => {
        throw new ProjectPgQueryError(
          "Only SELECT and WITH queries are allowed on this endpoint.",
        );
      },
    });

    const response = await app.handle(
      request({ projectId: project.id, query: "DELETE FROM projects" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Only SELECT and WITH queries are allowed on this endpoint.",
    });
  });

  test("reports infrastructure failures as unavailable without diagnostics", async () => {
    const diagnostics: unknown[] = [];
    const app = createProjectPgQueryApp({
      getUser: async () => ({ getTeam: async () => ({ id: "team_1" }) }),
      authorizeProject: async () => ({ project, team: { id: "team_1" } }),
      executeQuery: async () => {
        throw new ProjectPgQueryUnavailableError(
          'role "versionless_pg_query" does not exist at db.internal:5432',
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
    const body = (await response.json()) as { error: string };
    // NODE_ENV=test scrubs like production: no role names, hosts, or ports.
    expect(body.error).toBe(
      "This service is temporarily unavailable. Please try again shortly.",
    );
    expect(body.error).not.toContain("db.internal");
    // The diagnostic still reaches the server log.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ projectId: project.id });
  });
});
