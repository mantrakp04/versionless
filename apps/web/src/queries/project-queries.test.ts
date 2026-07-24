import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";

import { hexclaveClientApp } from "@/hexclave/client";

import {
  adoptionQueryOptions,
  sunsetBlockersQueryOptions,
  transformDepthQueryOptions,
  versionPagesQueryOptions,
} from "./insights";
import { telemetryQueryOptions } from "./telemetry";
import { traceListQueryOptions, type TraceSummary } from "./traces";

const projectId = "11111111-1111-4111-8111-111111111111";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("dashboard project queries", () => {
  test("are represented as React Query options and leave tenancy to row policies", () => {
    const adoption = adoptionQueryOptions(projectId, 30);
    const telemetry = telemetryQueryOptions({
      projectId,
      hours: 24,
      signal: "all",
      limit: 100,
    });
    const traces = traceListQueryOptions({
      projectId,
      hours: 24,
      errorsOnly: false,
      sort: "time",
      direction: "desc",
    });

    for (const options of [adoption, telemetry, traces]) {
      expect(options.queryKey[0]).toBe("project-query");
      expect(typeof options.queryFn).toBe("function");
      expect(options.retry).toBe(false);
      expect(options.enabled).toBe(true);
      expect(JSON.stringify(options.queryKey)).not.toContain(
        "ResourceAttributes['versionless.project.id']",
      );
    }
  });

  test("keeps one cache entry per dataset across sort changes", () => {
    const blockerInput = { projectId, version: "2025-06-01" } as const;
    const driftInput = { projectId, days: 30 } as const;
    const traceInput = { projectId, hours: 24, errorsOnly: false } as const;

    expect(
      sunsetBlockersQueryOptions({
        ...blockerInput,
        sort: "route",
        direction: "asc",
      }).queryKey,
    ).toEqual(
      sunsetBlockersQueryOptions({
        ...blockerInput,
        sort: "requests",
        direction: "desc",
      }).queryKey,
    );
    expect(
      transformDepthQueryOptions({
        ...driftInput,
        sort: "p95",
        direction: "asc",
      }).queryKey,
    ).toEqual(
      transformDepthQueryOptions({
        ...driftInput,
        sort: "avg",
        direction: "desc",
      }).queryKey,
    );
    expect(
      traceListQueryOptions({
        ...traceInput,
        sort: "duration",
        direction: "asc",
      }).queryKey,
    ).toEqual(
      traceListQueryOptions({
        ...traceInput,
        sort: "time",
        direction: "desc",
      }).queryKey,
    );
  });

  test("reorders the cached rows client-side through select", () => {
    const blockers = sunsetBlockersQueryOptions({
      projectId,
      version: "2025-06-01",
      sort: "requests",
      direction: "desc",
    });
    const drift = transformDepthQueryOptions({
      projectId,
      days: 30,
      sort: "avg",
      direction: "desc",
    });
    const traces = traceListQueryOptions({
      projectId,
      hours: 24,
      errorsOnly: false,
      sort: "duration",
      direction: "asc",
    });

    const blocker = (consumerKey: string, requests: number) => ({
      consumerKey,
      route: "GET /users",
      version: "2025-06-01",
      requests,
      lastSeen: "2026-07-23 12:00:00.000",
    });
    expect(
      blockers.select?.([blocker("beta", 5), blocker("alpha", 50)]),
    ).toEqual([blocker("alpha", 50), blocker("beta", 5)]);

    const driftRow = (route: string, avgDepth: number) => ({
      route,
      avgDepth,
      maxDepth: 4,
      p95Depth: 3,
      requests: 10,
    });
    expect(
      drift.select?.([driftRow("GET /users", 1), driftRow("GET /teams", 3)]),
    ).toEqual([driftRow("GET /teams", 3), driftRow("GET /users", 1)]);

    const trace = (traceId: string, durationMs: number): TraceSummary => ({
      traceId,
      ts: "2026-07-23 12:00:00.000",
      route: "GET /users",
      version: "2025-06-01",
      status: 200,
      durationMs,
      spanCount: 3,
      hasError: false,
    });
    expect(traces.select?.([trace("b", 20), trace("a", 5)])).toEqual([
      trace("a", 5),
      trace("b", 20),
    ]);
  });

  test("groups the 24 hour adoption view hourly and longer views daily", () => {
    const hourly = adoptionQueryOptions(projectId, 1);
    const daily = adoptionQueryOptions(projectId, 7);

    expect(JSON.stringify(hourly.queryKey)).toContain("toStartOfHour(Timestamp)");
    expect(JSON.stringify(daily.queryKey)).toContain("toStartOfDay(Timestamp)");
  });

  test("uses React Query infinite options for the versions table", () => {
    const options = versionPagesQueryOptions(new QueryClient(), {
      projectId,
      days: 30,
      sort: "version",
      direction: "desc",
      limit: 25,
    });

    expect(options.queryKey[0]).toBe("project-query");
    expect(options.initialPageParam).toBe(0);
    expect(typeof options.queryFn).toBe("function");
    expect(typeof options.getNextPageParam).toBe("function");
  });

  test("reuses one cached aggregation when loading subsequent version pages", async () => {
    spyOn(hexclaveClientApp, "getAuthorizationHeader").mockResolvedValue(
      "Bearer test-token",
    );
    const rawQuery = mock(async () =>
      Response.json({
        result: [
          {
            version: "2026-07-21",
            clients: "12",
            requests: "120",
            last_seen: "2026-07-23 12:00:00.000",
          },
          {
            version: "2025-06-01",
            clients: "5",
            requests: "50",
            last_seen: "2026-07-22 12:00:00.000",
          },
        ],
      }),
    );
    globalThis.fetch = rawQuery as unknown as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new InfiniteQueryObserver(
      queryClient,
      versionPagesQueryOptions(queryClient, {
        projectId,
        days: 30,
        sort: "version",
        direction: "desc",
        limit: 1,
      }),
    );

    await observer.refetch();
    await observer.fetchNextPage();

    expect(rawQuery).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data?.pages).toHaveLength(2);
  });
});
