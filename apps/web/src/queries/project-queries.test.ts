import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";

import { hexclaveClientApp } from "@/hexclave/client";

import {
  adoptionQueryOptions,
  presentVersions,
  sortVersions,
  sunsetBlockersQueryOptions,
  sunsetFor,
  selectTransformDepthChartRows,
  transformDepthQueryOptions,
  versionAggregationQueryOptions,
  type DriftRow,
  type VersionSummary,
  versionRouteAnalyticsQueryOptions,
  versionPagesQueryOptions,
} from "./insights";
import { telemetryQueryOptions } from "./telemetry";
import {
  traceEventsQueryOptions,
  traceListQueryOptions,
  traceSpansQueryOptions,
  type TraceSummary,
} from "./traces";
import {
  errorGroupKey,
  errorGroupHistoryQueryOptions,
  errorGroupOccurrencesQueryOptions,
  errorOccurrenceDetailQueryOptions,
  errorOverviewQueryOptions,
  parseErrorGroupKey,
} from "./errors";

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

    expect(JSON.stringify(hourly.queryKey)).toContain(
      "toStartOfHour(Timestamp)",
    );
    expect(JSON.stringify(daily.queryKey)).toContain("toStartOfDay(Timestamp)");
  });

  test("counts errors from the unsampled request log, never from traces", () => {
    const overview = errorOverviewQueryOptions({
      projectId,
      days: 7,
      limit: 6,
    });
    const key = JSON.stringify(overview.queryKey);

    // Logs are the authoritative count signal even though current SDKs promote
    // every failure, because trace capture can be disabled or filtered.
    expect(key).toContain("FROM otel_logs");
    expect(key).not.toContain("otel_traces");
    expect(key).not.toContain("SpanAttributes");
    expect(key).toContain("EventName = 'versionless.request'");

    // Numerator and denominator must come from the same scan for the rate to
    // be meaningful.
    expect(key).toContain("countIf(is_error) AS occurrences");
    expect(key).toContain("count() AS requests");

    expect(key).toContain("toStartOfDay");
    expect(key).toContain("GROUP BY GROUPING SETS");
    expect(key).toContain("LogAttributes['versionless.version']");
    expect(key).not.toContain("StatusMessage");

    const history = errorGroupHistoryQueryOptions({
      projectId,
      days: 7,
      version: "2026-06-01",
      route: "POST /v1/query",
      status: 500,
    });
    const occurrences = errorGroupOccurrencesQueryOptions({
      projectId,
      days: 7,
      version: "2026-06-01",
      route: "POST /v1/query",
      status: 500,
    });

    // The per-signature trend is also a count, so it reads logs too.
    expect(JSON.stringify(history.queryKey)).toContain("FROM otel_logs");
    expect(JSON.stringify(history.queryKey)).not.toContain("otel_traces");
    expect(JSON.stringify(history.queryKey)).toContain(
      "LogAttributes['versionless.version'] = {version: String}",
    );
    expect(JSON.stringify(history.queryKey)).toContain("count() AS requests");

    // Individual occurrences to open come from trace detail.
    expect(JSON.stringify(occurrences.queryKey)).toContain("FROM otel_traces");
    expect(JSON.stringify(occurrences.queryKey)).toContain(
      "LIMIT {occurrenceLimit: UInt16}",
    );
    expect(occurrences.initialPageParam).toBeNull();
    expect(typeof occurrences.getNextPageParam).toBe("function");
    expect(JSON.stringify(occurrences.queryKey)).toContain(
      "parseDateTime64BestEffortOrNull({cursorStartedAt: String})",
    );
    expect(JSON.stringify(occurrences.queryKey)).toContain(
      "Timestamp DESC, TraceId DESC",
    );
    expect(JSON.stringify(occurrences.queryKey)).toContain(
      "SELECT selected_roots.trace_id AS trace_id",
    );
    expect(JSON.stringify(occurrences.queryKey)).not.toContain("otel_logs");
    expect(JSON.stringify(occurrences.queryKey)).not.toContain(
      "SAFE_SPAN_ATTRIBUTES",
    );
    expect(JSON.stringify(occurrences.queryKey)).not.toContain("StatusMessage");
    expect(JSON.stringify(occurrences.queryKey)).not.toContain("Body");
    expect(JSON.stringify(occurrences.queryKey)).not.toContain(
      "exception.message",
    );

    const detail = errorOccurrenceDetailQueryOptions({
      projectId,
      occurrence: {
        traceId: "trace-1",
        ts: "2026-07-24T20:15:00.000Z",
        durationMs: 42,
      },
      version: "2026-06-01",
      route: "POST /v1/query",
      status: 500,
    });
    expect(JSON.stringify(detail.queryKey)).toContain(
      "PREWHERE Timestamp >= addMilliseconds",
    );
    expect(JSON.stringify(detail.queryKey)).toContain(
      "parseDateTime64BestEffort({startedAt: String})",
    );
    expect(JSON.stringify(detail.queryKey)).toContain(
      "{durationMs: Float64}",
    );
    expect(JSON.stringify(detail.queryKey)).toContain(
      "ORDER BY abs(dateDiff('millisecond'",
    );
    expect(JSON.stringify(detail.queryKey)).not.toContain(
      "toUnixTimestamp64Milli(Timestamp) =",
    );
    expect(JSON.stringify(detail.queryKey)).toContain('"durationMs":42');
    expect(JSON.stringify(detail.queryKey)).toContain(
      "TraceId = {trace: String}",
    );
    expect(JSON.stringify(detail.queryKey)).toContain(
      "'versionless.change'",
    );
    expect(JSON.stringify(detail.queryKey)).toContain(
      "'http.response.status_code'",
    );
    expect(JSON.stringify(detail.queryKey)).not.toContain("StatusMessage");
    expect(JSON.stringify(detail.queryKey)).toContain(
      "JSONExtractString(any(Body), 'code')",
    );
    expect(JSON.stringify(detail.queryKey)).toContain(
      "JSONExtractString(any(Body), 'message')",
    );
    expect(JSON.stringify(detail.queryKey)).not.toContain("Body AS body");

    const traceEvents = traceEventsQueryOptions(projectId, {
      traceId: "trace-1",
      ts: "2026-07-24T20:15:00.000Z",
      route: "POST /v1/query",
      version: "2026-06-01",
      status: 500,
      durationMs: 42,
      spanCount: 4,
      hasError: true,
    });
    expect(JSON.stringify(traceEvents.queryKey)).toContain(
      "EventName = 'versionless.request'",
    );
    expect(JSON.stringify(traceEvents.queryKey)).toContain(
      "PREWHERE Timestamp >= addMilliseconds",
    );
    expect(JSON.stringify(traceEvents.queryKey)).toContain(
      "ORDER BY abs(dateDiff('millisecond'",
    );
    expect(JSON.stringify(traceEvents.queryKey)).not.toContain(
      "toUnixTimestamp64Milli(Timestamp) =",
    );
    expect(JSON.stringify(traceEvents.queryKey)).toContain('"durationMs":42');
    expect(JSON.stringify(traceEvents.queryKey)).toContain(
      "'versionless.consumer.key'",
    );
    expect(JSON.stringify(traceEvents.queryKey)).toContain(
      "JSONExtractString(any(Body), 'code')",
    );
    expect(JSON.stringify(traceEvents.queryKey)).toContain(
      "JSONExtractString(any(Body), 'message')",
    );
    expect(JSON.stringify(traceEvents.queryKey)).not.toContain("Body AS body");

    const traceSpans = traceSpansQueryOptions(projectId, "trace-1");
    expect(JSON.stringify(traceSpans.queryKey)).toContain("has_error");
    expect(JSON.stringify(traceSpans.queryKey)).not.toContain("StatusMessage");
  });

  test("returns the allowlisted error body with trace log events", async () => {
    spyOn(hexclaveClientApp, "getAuthorizationHeader").mockResolvedValue(
      "Bearer test-token",
    );
    globalThis.fetch = mock(async () =>
      Response.json({
        result: [
          {
            ts: "2026-07-24T20:15:00.042Z",
            start_ms: "1753388100042",
            event_name: "versionless.request",
            severity: "ERROR",
            error_code: "internal_error",
            error_message: "The request could not be completed.",
            attrs: '{"http.response.status_code":"500"}',
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const observer = new QueryObserver(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      traceEventsQueryOptions(projectId, {
        traceId: "trace-1",
        ts: "2026-07-24T20:15:00.000Z",
        route: "POST /v1/query",
        version: "2026-06-01",
        status: 500,
        durationMs: 42,
        spanCount: 4,
        hasError: true,
      }),
    );
    const result = await observer.refetch();

    expect(result.data?.[0]?.errorBody).toEqual({
      code: "internal_error",
      message: "The request could not be completed.",
    });
  });

  test("keeps the transform-depth chart bounded to the busiest routes", () => {
    const row = (route: string, requests: number): DriftRow => ({
      route,
      avgDepth: 1,
      maxDepth: 4,
      p95Depth: 3,
      requests,
    });
    const rows = Array.from({ length: 40 }, (_, index) =>
      row(`GET /route-${index}`, index),
    );

    const selected = selectTransformDepthChartRows(rows, 16);
    expect(selected).toHaveLength(16);
    expect(selected[0]?.requests).toBe(39);
    expect(selected.at(-1)?.requests).toBe(24);

    const query = transformDepthQueryOptions({
      projectId,
      days: 30,
      sort: "avg",
      direction: "desc",
    });
    expect(JSON.stringify(query.queryKey)).toContain("quantileTDigest");
    expect(JSON.stringify(query.queryKey)).toContain("PREWHERE Timestamp");
  });

  test("extracts only the allowlisted error summary from occurrence log bodies", () => {
    const detail = errorOccurrenceDetailQueryOptions({
      projectId,
      occurrence: {
        traceId: "trace-safe-body",
        ts: "2026-07-24T20:15:00.000Z",
        durationMs: 42,
      },
      version: "2026-06-01",
      route: "POST /v1/query",
      status: 500,
    });
    const queryKey = JSON.stringify(detail.queryKey);

    expect(queryKey).toContain("JSONExtractString(any(Body), 'code')");
    expect(queryKey).toContain("JSONExtractString(any(Body), 'message')");
    expect(queryKey).toContain("leftUTF8");
    expect(queryKey).not.toContain("Body AS body");
  });

  test("round-trips URL-addressable error signatures", () => {
    const signature = {
      version: "2026-06-01",
      route: "POST /v1/query",
      status: 500,
    };

    expect(parseErrorGroupKey(errorGroupKey(signature))).toEqual(signature);
    expect(parseErrorGroupKey("not-json")).toBeNull();
  });

  test("limits telemetry rows before serializing attribute maps", () => {
    const telemetry = telemetryQueryOptions({
      projectId,
      hours: 720,
      signal: "all",
      limit: 100,
    });
    const query = JSON.stringify(telemetry.queryKey);

    expect(query).toContain("LogAttributes AS attributes_map");
    expect(query).toContain("SpanAttributes AS attributes_map");
    expect(query).toContain("LIMIT {limit: UInt16}");
    expect(query).not.toContain("toJSONString(LogAttributes)");
    expect(query).not.toContain("toJSONString(SpanAttributes)");
  });

  test("sorts sunset schedules in both directions without hiding unscheduled versions", () => {
    const row = (
      version: string,
      sunsetAfter: string | null,
    ): VersionSummary => ({
      version,
      sunsetAfter,
      clients: 0,
      requests: 0,
      lastSeen: null,
    });
    const versions = [
      row("2026-07-21", null),
      row("2025-01-01", "2026-12-31"),
      row("2024-12-01", "2026-12-31"),
    ];

    expect(
      sortVersions(versions, "sunsetAfter", "asc").map(
        (version) => version.version,
      ),
    ).toEqual(["2025-01-01", "2024-12-01", "2026-07-21"]);
    expect(
      sortVersions(versions, "sunsetAfter", "desc").map(
        (version) => version.version,
      ),
    ).toEqual(["2026-07-21", "2025-01-01", "2024-12-01"]);
  });

  test("scopes version detail analytics to the selected version", () => {
    const routes = versionRouteAnalyticsQueryOptions({
      projectId,
      version: "2026-07-24",
      days: 7,
    });
    const traces = traceListQueryOptions({
      projectId,
      version: "2026-07-24",
      hours: 168,
      errorsOnly: false,
      sort: "time",
      direction: "desc",
    });

    expect(JSON.stringify(routes.queryKey)).toContain(
      "LogAttributes['versionless.version'] = {version: String}",
    );
    expect(JSON.stringify(routes.queryKey)).toContain("2026-07-24");
    expect(JSON.stringify(traces.queryKey)).toContain(
      "root_version = {version: String}",
    );
    expect(JSON.stringify(traces.queryKey)).toContain("2026-07-24");
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

  test("loads error occurrences in cursor-based pages", async () => {
    spyOn(hexclaveClientApp, "getAuthorizationHeader").mockResolvedValue(
      "Bearer test-token",
    );
    const occurrenceRow = (traceId: string, startedAt: string) => ({
      trace_id: traceId,
      started_at: startedAt,
      root_duration_ms: "42",
      span_id: `${traceId}-span`,
      parent_span_id: "",
      span_name: "versionless.exchange",
      span_ts: startedAt,
      span_start_ms: String(Date.parse(startedAt)),
      span_duration_ms: "42",
      span_has_error: "true",
      span_attrs: "{}",
      log_ts: "",
      log_start_ms: "0",
      log_event_name: "",
      log_severity: "",
      log_attrs: "{}",
    });
    const requestedParams: Array<Record<string, unknown>> = [];
    const rawQuery = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          params: Record<string, unknown>;
        };
        requestedParams.push(body.params);
        return Response.json({
          result:
            requestedParams.length === 1
              ? [
                  occurrenceRow("trace-2", "2026-07-25T12:00:00.000Z"),
                  occurrenceRow("trace-1", "2026-07-25T11:00:00.000Z"),
                ]
              : [occurrenceRow("trace-0", "2026-07-25T10:00:00.000Z")],
        });
      },
    );
    globalThis.fetch = rawQuery as unknown as typeof fetch;

    const observer = new InfiniteQueryObserver(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      errorGroupOccurrencesQueryOptions({
        projectId,
        days: 7,
        version: "2026-06-01",
        route: "POST /v1/query",
        status: 500,
        limit: 2,
      }),
    );

    await observer.refetch();
    await observer.fetchNextPage();

    expect(rawQuery).toHaveBeenCalledTimes(2);
    expect(requestedParams[0]?.cursorStartedAt).toBe("");
    expect(requestedParams[1]?.cursorStartedAt).toBe(
      "2026-07-25T11:00:00.000Z",
    );
    expect(requestedParams[1]?.cursorTraceId).toBe("trace-1");
    expect(observer.getCurrentResult().data?.pages).toHaveLength(2);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
  });

  test("resolves the binding sunset the same way the wire gate does", () => {
    // A sunset on X covers every version <= X, and when several apply the
    // earliest cutoff wins (packages/core/src/sunset.ts). Showing the latest
    // would tell a user they have months left on a cohort already retired.
    const sunsets = [
      { version: "2025-06-01", after: "2026-12-31", message: null },
      { version: "2026-01-01", after: "2026-09-30", message: "Upgrade." },
    ];

    expect(sunsetFor("2025-01-01", sunsets)).toBe("2026-09-30");
    expect(sunsetFor("2025-06-01", sunsets)).toBe("2026-09-30");
    expect(sunsetFor("2025-06-02", sunsets)).toBe("2026-09-30");
    expect(sunsetFor("2026-01-01", sunsets)).toBe("2026-09-30");
    // Newer than every declared sunset — not covered by any of them.
    expect(sunsetFor("2026-07-01", sunsets)).toBe(null);
    expect(sunsetFor("2026-07-01", [])).toBe(null);
  });

  test("shows released versions with no traffic and carries their sunset", () => {
    // A released version with zero traffic is exactly the one worth retiring,
    // so it has to appear rather than be filtered out by the traffic query.
    const rows = [
      {
        version: "2026-07-21",
        clients: "12",
        requests: "120",
        last_seen: "2026-07-23 12:00:00.000",
      },
    ];

    expect(
      presentVersions(rows, {
        versions: ["2025-06-01", "2026-07-21"],
        sunsets: [{ version: "2025-06-01", after: "2026-09-30", message: null }],
      }),
    ).toEqual([
      {
        version: "2025-06-01",
        clients: 0,
        requests: 0,
        lastSeen: null,
        sunsetAfter: "2026-09-30",
      },
      {
        version: "2026-07-21",
        clients: 12,
        requests: 120,
        lastSeen: "2026-07-23 12:00:00.000",
        sunsetAfter: null,
      },
    ]);

    // Without uploaded release metadata the list is traffic only, and nothing
    // claims a sunset we were never told about.
    expect(presentVersions(rows)).toEqual([
      {
        version: "2026-07-21",
        clients: 12,
        requests: 120,
        lastSeen: "2026-07-23 12:00:00.000",
        sunsetAfter: null,
      },
    ]);
  });

  test("re-keys the version aggregation when release metadata changes", () => {
    // The SQL is identical either way; only the tRPC-sourced metadata differs.
    // Without it in the key an upload that adds a sunset would keep serving a
    // cached "no sunset" verdict.
    const before = versionAggregationQueryOptions(projectId, 30, {
      versions: ["2025-06-01"],
      sunsets: [],
    });
    const after = versionAggregationQueryOptions(projectId, 30, {
      versions: ["2025-06-01"],
      sunsets: [{ version: "2025-06-01", after: "2026-09-30", message: null }],
    });

    expect(JSON.stringify(before.queryKey)).not.toEqual(
      JSON.stringify(after.queryKey),
    );
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
