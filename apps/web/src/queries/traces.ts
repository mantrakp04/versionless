import { queryOptions } from "@tanstack/react-query";

import { compareNullable } from "@/queries/insights";
import { projectQueryOptions } from "@/utils/project-query";

export type TraceSort =
  | "time"
  | "route"
  | "version"
  | "status"
  | "duration"
  | "spans";
export type SortDirection = "asc" | "desc";

export interface TraceSummary {
  traceId: string;
  ts: string;
  route: string;
  version: string;
  status: number;
  durationMs: number;
  spanCount: number;
  hasError: boolean;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  ts: string;
  startMs: number;
  durationMs: number;
  hasError: boolean;
  error: string | null;
  attrs: Record<string, string | number | boolean>;
}

const traceSortKeys = {
  time: "ts",
  route: "route",
  version: "version",
  status: "status",
  duration: "durationMs",
  spans: "spanCount",
} satisfies Record<TraceSort, keyof TraceSummary>;

function sortTraces(
  traces: TraceSummary[],
  sort: TraceSort,
  direction: SortDirection,
): TraceSummary[] {
  const key = traceSortKeys[sort];
  return traces.toSorted((left, right) => {
    const compared = compareNullable(left[key], right[key], direction);
    if (compared !== 0) return compared;
    return sort === "time"
      ? left.traceId.localeCompare(right.traceId)
      : right.ts.localeCompare(left.ts) ||
          left.traceId.localeCompare(right.traceId);
  });
}

export function traceListQueryOptions(input: {
  projectId: string;
  hours: number;
  errorsOnly: boolean;
  sort: TraceSort;
  direction: SortDirection;
  limit?: number;
}) {
  // The SQL order is fixed so sort clicks reorder the cached rows client-side
  // instead of re-running the aggregation.
  return queryOptions({
    ...projectQueryOptions<
      {
        trace_id: string;
        started_at: string;
        root_route: string;
        root_version: string;
        root_status: string;
        root_duration_ms: string;
        span_count: string;
        error_count: string;
      },
      TraceSummary[]
    >(
      "trace-list",
      {
        projectId: input.projectId,
        query: `SELECT TraceId AS trace_id,
       min(Timestamp) AS started_at,
       anyIf(SpanAttributes['versionless.route'], SpanName = 'versionless.exchange') AS root_route,
       anyIf(SpanAttributes['versionless.version'], SpanName = 'versionless.exchange') AS root_version,
       toUInt16OrZero(anyIf(SpanAttributes['versionless.status'], SpanName = 'versionless.exchange')) AS root_status,
       maxIf(Duration / 1000000, SpanName = 'versionless.exchange') AS root_duration_ms,
       count() AS span_count, countIf(StatusCode = 'Error') AS error_count
FROM otel_traces
WHERE Timestamp >= now() - INTERVAL {hours: UInt16} HOUR
GROUP BY TraceId
HAVING countIf(SpanName = 'versionless.exchange') > 0
  ${input.errorsOnly ? "AND error_count > 0" : ""}
ORDER BY started_at DESC, trace_id ASC
LIMIT {limit: UInt16}`,
        params: { hours: input.hours, limit: input.limit ?? 50 },
      },
      (rows) =>
        rows.map((row) => ({
          traceId: row.trace_id,
          ts: row.started_at,
          route: row.root_route,
          version: row.root_version,
          status: Number(row.root_status),
          durationMs: Number(row.root_duration_ms),
          spanCount: Number(row.span_count),
          hasError: Number(row.error_count) > 0,
        })),
    ),
    select: (traces) => sortTraces(traces, input.sort, input.direction),
  });
}

function parseAttrs(raw: string): Record<string, string | number | boolean> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string | number | boolean>)
      : {};
  } catch {
    return {};
  }
}

export function traceSpansQueryOptions(projectId: string, traceId: string) {
  return projectQueryOptions<
    {
      span_id: string;
      parent_span_id: string;
      name: string;
      ts: string;
      start_ms: string;
      duration_ms: string;
      error: string;
      attrs: string;
    },
    TraceSpan[]
  >(
    "trace-spans",
    {
      projectId,
      query: `SELECT *
FROM (
  SELECT SpanId AS span_id, ParentSpanId AS parent_span_id,
         SpanName AS name, Timestamp AS ts,
         toUnixTimestamp64Milli(Timestamp) AS start_ms,
         Duration / 1000000 AS duration_ms,
         if(StatusCode = 'Error', StatusMessage, '') AS error,
         toJSONString(SpanAttributes) AS attrs
  FROM otel_traces
  WHERE TraceId = {trace: String}
  ORDER BY Timestamp DESC
  LIMIT 1 BY SpanId
)
ORDER BY ts ASC, span_id ASC
LIMIT 256`,
      params: { trace: traceId },
    },
    (rows) =>
      rows.map((row) => ({
        spanId: row.span_id,
        parentSpanId: row.parent_span_id || null,
        name: row.name,
        ts: row.ts,
        startMs: Number(row.start_ms),
        durationMs: Number(row.duration_ms),
        hasError: row.error !== "",
        error: row.error || null,
        attrs: parseAttrs(row.attrs),
      })),
  );
}
