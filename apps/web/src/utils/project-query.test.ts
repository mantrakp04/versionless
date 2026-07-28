import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { hexclaveClientApp } from "@/hexclave/client";

import {
  isProjectQueryUnavailable,
  projectPgQuery,
  projectPgQueryOptions,
  projectQuery,
  projectQueryOptions,
  ProjectQueryHttpError,
} from "./project-query";

const projectId = "11111111-1111-4111-8111-111111111111";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

function captureRequests(respond: () => Response) {
  spyOn(hexclaveClientApp, "getAuthorizationHeader").mockResolvedValue(
    "Bearer test-token",
  );
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return respond();
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return seen;
}

describe("the two query planes", () => {
  test("post to their own endpoint with the store's parameter shape", async () => {
    const seen = captureRequests(() => Response.json({ result: [{ n: 1 }] }));

    await projectQuery(projectId, "SELECT 1", { days: 7 });
    // Postgres binds by position, so params stays an ordered array — sending
    // ClickHouse's named record would silently bind nothing.
    await projectPgQuery(projectId, "SELECT 1", ["2026-07-24"]);

    expect(seen[0]?.url).toEndWith("/v1/query");
    expect(seen[0]?.body).toEqual({
      projectId,
      query: "SELECT 1",
      params: { days: 7 },
      timeoutMs: 10_000,
    });
    expect(seen[1]?.url).toEndWith("/v1/pg-query");
    expect(seen[1]?.body).toEqual({
      projectId,
      query: "SELECT 1",
      params: ["2026-07-24"],
      timeoutMs: 10_000,
    });
  });

  test("cache under distinct key prefixes so identical SQL cannot cross stores", () => {
    const clickhouse = projectQueryOptions("rows", {
      projectId,
      query: "SELECT 1",
    });
    const postgres = projectPgQueryOptions("rows", {
      projectId,
      query: "SELECT 1",
    });

    expect(clickhouse.queryKey[0]).toBe("project-query");
    expect(postgres.queryKey[0]).toBe("project-pg-query");
    expect(postgres.queryKey).not.toEqual(
      clickhouse.queryKey as unknown as typeof postgres.queryKey,
    );
    // An empty project id means the route has not resolved a scope yet;
    // firing anyway would ask the server to authorize "".
    expect(
      projectPgQueryOptions("rows", { projectId: "", query: "SELECT 1" })
        .enabled,
    ).toBe(false);
  });

  test("shape rows through select and key on the extra inputs that shape them", async () => {
    captureRequests(() => Response.json({ result: [{ n: 1 }, { n: 2 }] }));

    const options = projectPgQueryOptions<{ n: number }, number>(
      "total",
      { projectId, query: "SELECT n FROM t", params: [3], keyExtra: "v2" },
      (rows) => rows.reduce((sum, row) => sum + row.n, 0),
    );

    expect(options.queryKey).toEqual([
      "project-pg-query",
      "total",
      projectId,
      "SELECT n FROM t",
      [3],
      "v2",
    ] as never);

    const observer = new QueryObserver(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      options,
    );
    await observer.refetch();
    expect(observer.getCurrentResult().data).toBe(3);
  });

  test("surface the server's public message and never retry a rejected query", async () => {
    captureRequests(() =>
      Response.json(
        { error: "Only SELECT and WITH queries are allowed on this endpoint." },
        { status: 400 },
      ),
    );

    const error = await projectPgQuery(projectId, "DELETE FROM projects").then(
      () => new Error("expected the query to fail"),
      (caught: unknown) => caught as ProjectQueryHttpError,
    );

    expect(error).toBeInstanceOf(ProjectQueryHttpError);
    expect(error.message).toBe(
      "Only SELECT and WITH queries are allowed on this endpoint.",
    );
    expect((error as ProjectQueryHttpError).status).toBe(400);
    // A bad query is the caller's fault; retrying just burns the query budget.
    expect(isProjectQueryUnavailable(error)).toBe(false);
    expect(projectPgQueryOptions("x", { projectId, query: "SELECT 1" }).retry).toBe(
      false,
    );
  });

  test("treat an unavailable store as retryable and a malformed body as a bad gateway", async () => {
    captureRequests(() =>
      Response.json(
        {
          error:
            "This service is temporarily unavailable. Please try again shortly.",
        },
        { status: 503 },
      ),
    );
    const unavailable = await projectPgQuery(projectId, "SELECT 1").then(
      () => new Error("expected the query to fail"),
      (caught: unknown) => caught as ProjectQueryHttpError,
    );
    expect(unavailable.message).not.toContain("versionless_pg_query");
    expect(isProjectQueryUnavailable(unavailable)).toBe(true);

    captureRequests(() => Response.json({ result: "not-an-array" }));
    const malformed = await projectPgQuery(projectId, "SELECT 1").then(
      () => new Error("expected the query to fail"),
      (caught: unknown) => caught as ProjectQueryHttpError,
    );
    expect(malformed.message).toBe("The query returned an invalid response");
    expect((malformed as ProjectQueryHttpError).status).toBe(502);
  });
});
