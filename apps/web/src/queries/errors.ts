import {
  infiniteQueryOptions,
  type InfiniteData,
} from "@tanstack/react-query";

import {
  parseTelemetryAttributes,
  SAFE_SPAN_ATTRIBUTES_SQL,
} from "@/queries/safe-telemetry-metadata";
import {
  correlatedRequestLogSql,
  requestLogCorrelationParams,
  requestLogErrorBody,
} from "@/queries/request-log-correlation";
import { projectQuery, projectQueryOptions } from "@/utils/project-query";

export interface ErrorCurvePoint {
  bucket: string;
  errors: number;
  /** Total requests in the bucket, so a rate is derivable per point. */
  requests: number;
}

export interface RecentVersionErrorGroup {
  latestAt: string;
  version: string;
  route: string;
  status: number;
  occurrences: number;
  latestDurationMs: number;
}

export interface ErrorGroupSignature {
  version: string;
  route: string;
  status: number;
}

export function errorGroupKey(error: ErrorGroupSignature): string {
  return JSON.stringify([error.version, error.route, error.status]);
}

export function parseErrorGroupKey(
  value: string | undefined,
): ErrorGroupSignature | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      typeof parsed[2] !== "number"
    ) {
      return null;
    }
    return { version: parsed[0], route: parsed[1], status: parsed[2] };
  } catch {
    return null;
  }
}

export interface ErrorOccurrenceSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  ts: string;
  startMs: number;
  durationMs: number;
  hasError: boolean;
  attrs: Record<string, string | number | boolean>;
}

export interface ErrorOccurrenceLog {
  ts: string;
  startMs: number;
  eventName: string;
  severity: string;
  errorBody: {
    code: string;
    message: string;
  } | null;
  attrs: Record<string, string | number | boolean>;
}

export interface ErrorOccurrence {
  traceId: string;
  ts: string;
  durationMs: number;
}

export interface ErrorOccurrenceDetail {
  spans: ErrorOccurrenceSpan[];
  log: ErrorOccurrenceLog | null;
}

export interface ErrorOccurrenceCursor {
  startedAt: string;
  traceId: string;
}

export interface ErrorOccurrencePage {
  items: ErrorOccurrence[];
  nextCursor: ErrorOccurrenceCursor | undefined;
}

export interface ErrorOverviewData {
  curve: ErrorCurvePoint[];
  recent: RecentVersionErrorGroup[];
  /** Requests and errors over the whole window, from one unsampled scan. */
  totals: { requests: number; errors: number; errorRate: number };
}

/**
 * Error *counts* come from `otel_logs`, never from `otel_traces`.
 *
 * Request logs are unsampled and carry `http.response.status_code` on every
 * request, so numerator and denominator come out of a single authoritative
 * scan. Current SDKs always promote failed exchanges to trace capture, but
 * traces can still be disabled, filtered, or missing from older clients.
 *
 * Traces remain the drill-down into *individual* failures — see
 * `errorGroupOccurrencesQueryOptions`.
 */
function errorLogsSql(options?: {
  bucketExpression?: string;
  matchSignature?: boolean;
  /** Scope to one version+route, leaving status free to compare against. */
  matchRoute?: boolean;
  /**
   * Keep successful requests too, flagged via `is_error`. Required whenever a
   * rate is computed, so the denominator comes from this same scan.
   */
  allRequests?: boolean;
}): string {
  return `SELECT ${options?.bucketExpression ? `${options.bucketExpression} AS bucket,` : ""}
       Timestamp AS started_at,
       LogAttributes['versionless.version'] AS root_version,
       LogAttributes['versionless.route'] AS root_route,
       toUInt16OrZero(LogAttributes['http.response.status_code']) AS root_status,
       toUInt16OrZero(LogAttributes['http.response.status_code']) >= 400 AS is_error,
       toFloat64OrZero(LogAttributes['versionless.latency_ms']) AS root_duration_ms
FROM otel_logs
WHERE EventName = 'versionless.request'
  AND Timestamp >= now() - INTERVAL {hours: UInt16} HOUR
  ${
    options?.allRequests
      ? ""
      : "AND toUInt16OrZero(LogAttributes['http.response.status_code']) >= 400"
  }
  ${
    options?.matchSignature || options?.matchRoute
      ? `AND LogAttributes['versionless.version'] = {version: String}
  AND LogAttributes['versionless.route'] = {route: String}`
      : ""
  }
  ${
    options?.matchSignature
      ? "AND toUInt16OrZero(LogAttributes['http.response.status_code']) = {status: UInt16}"
      : ""
  }`;
}

/**
 * Sampled per-failure roots, for listing individual occurrences to open. The
 * page size bounds the scan; the resulting list is explicitly a subset of the
 * counts above and the UI says so.
 */
function errorTraceRootsSql(): string {
  return `SELECT TraceId AS trace_id,
       Timestamp AS started_at,
       Duration / 1000000 AS root_duration_ms
FROM otel_traces
WHERE Timestamp >= now() - INTERVAL {hours: UInt16} HOUR
  AND SpanName = 'versionless.exchange'
  AND StatusCode = 'Error'
  AND SpanAttributes['versionless.version'] = {version: String}
  AND SpanAttributes['versionless.route'] = {route: String}
  AND toUInt16OrZero(SpanAttributes['versionless.status']) = {status: UInt16}
  AND (
    isNull(parseDateTime64BestEffortOrNull({cursorStartedAt: String}))
    OR Timestamp < parseDateTime64BestEffortOrNull({cursorStartedAt: String})
    OR (
      Timestamp = parseDateTime64BestEffortOrNull({cursorStartedAt: String})
      AND TraceId < {cursorTraceId: String}
    )
  )
ORDER BY Timestamp DESC, TraceId DESC
LIMIT {occurrenceLimit: UInt16}`;
}

export function errorOverviewQueryOptions(input: {
  projectId: string;
  days: number;
  limit?: number;
}) {
  const bucketExpression =
    input.days === 1
      ? "toStartOfHour(Timestamp)"
      : "toStartOfDay(Timestamp)";

  // One scan over the unsampled request log yields all three shapes: the
  // per-bucket curve (with its denominator), the per-signature groups, and the
  // window totals the error rate is computed from.
  const groupingMask =
    "grouping(bucket, root_version, root_route, root_status)";

  return projectQueryOptions<
    {
      row_kind: "curve" | "group" | "total";
      bucket: string;
      root_version: string;
      root_route: string;
      root_status: string;
      occurrences: string;
      requests: string;
      latest_at: string;
      latest_duration_ms: string;
    },
    ErrorOverviewData
  >(
    "error-overview",
    {
      projectId: input.projectId,
      query: `WITH requests AS (
  ${errorLogsSql({ bucketExpression, allRequests: true })}
),
aggregated AS (
  SELECT multiIf(
           ${groupingMask} = 7, 'curve',
           ${groupingMask} = 8, 'group',
           'total'
         ) AS row_kind,
         bucket, root_version, root_route, root_status,
         countIf(is_error) AS occurrences,
         count() AS requests,
         maxIf(started_at, is_error) AS latest_at,
         argMaxIf(root_duration_ms, started_at, is_error) AS latest_duration_ms
  FROM requests
  GROUP BY GROUPING SETS (
    (bucket),
    (root_version, root_route, root_status),
    ()
  )
)
SELECT row_kind, bucket, root_version, root_route, root_status,
       occurrences, requests, latest_at, latest_duration_ms
FROM (
  SELECT *,
         row_number() OVER (
           PARTITION BY row_kind
           ORDER BY latest_at DESC
         ) AS row_rank
  FROM aggregated
  WHERE row_kind != 'group' OR occurrences > 0
)
WHERE row_kind != 'group' OR row_rank <= {limit: UInt16}
ORDER BY row_kind ASC, latest_at DESC`,
      params: { hours: input.days * 24, limit: input.limit ?? 30 },
    },
    (rows) => {
      const totalRow = rows.find((row) => row.row_kind === "total");
      const requests = Number(totalRow?.requests ?? 0);
      const errors = Number(totalRow?.occurrences ?? 0);
      return {
        curve: rows
          .filter((row) => row.row_kind === "curve")
          .map((row) => ({
            bucket: row.bucket,
            errors: Number(row.occurrences),
            requests: Number(row.requests),
          }))
          .toSorted((left, right) => left.bucket.localeCompare(right.bucket)),
        recent: rows
          .filter((row) => row.row_kind === "group")
          .map((row) => ({
            latestAt: row.latest_at,
            version: row.root_version || "unknown",
            route: row.root_route || "unknown route",
            status: Number(row.root_status),
            occurrences: Number(row.occurrences),
            latestDurationMs: Number(row.latest_duration_ms),
          })),
        totals: {
          requests,
          errors,
          errorRate: requests > 0 ? errors / requests : 0,
        },
      };
    },
  );
}

export function errorGroupHistoryQueryOptions(input: {
  projectId: string;
  days: number;
  version: string;
  route: string;
  status: number;
}) {
  const bucketExpression =
    input.days === 1
      ? "toStartOfHour(Timestamp)"
      : "toStartOfDay(Timestamp)";

  return projectQueryOptions<
    { bucket: string; occurrences: string; requests: string },
    ErrorCurvePoint[]
  >(
    "error-group-history",
    {
      projectId: input.projectId,
      // Route+version scoped, so `requests` is this signature's own denominator
      // — the share of that route/version's traffic that failed this way.
      query: `SELECT bucket,
       countIf(root_status = {status: UInt16}) AS occurrences,
       count() AS requests
FROM (
  ${errorLogsSql({ bucketExpression, matchRoute: true, allRequests: true })}
)
GROUP BY bucket
ORDER BY bucket ASC`,
      params: {
        hours: input.days * 24,
        version: input.version,
        route: input.route,
        status: input.status,
      },
    },
    (rows) =>
      rows.map((row) => ({
        bucket: row.bucket,
        errors: Number(row.occurrences),
        requests: Number(row.requests),
      })),
  );
}

export function errorGroupOccurrencesQueryOptions(input: {
  projectId: string;
  days: number;
  version: string;
  route: string;
  status: number;
  limit?: number;
}) {
  type Row = {
    trace_id: string;
    started_at: string;
    root_duration_ms: string;
  };
  type Key = readonly [
    "project-query",
    "error-group-occurrences",
    typeof input,
    string,
  ];
  const pageSize = input.limit ?? 20;
  const query = `WITH selected_roots AS (
  ${errorTraceRootsSql()}
)
SELECT selected_roots.trace_id AS trace_id,
       selected_roots.started_at AS started_at,
       selected_roots.root_duration_ms AS root_duration_ms
FROM selected_roots
ORDER BY selected_roots.started_at DESC, selected_roots.trace_id DESC`;

  return infiniteQueryOptions<
    ErrorOccurrencePage,
    Error,
    InfiniteData<ErrorOccurrencePage, ErrorOccurrenceCursor | null>,
    Key,
    ErrorOccurrenceCursor | null
  >({
    queryKey: ["project-query", "error-group-occurrences", input, query],
    initialPageParam: null,
    enabled: input.projectId !== "",
    retry: false,
    queryFn: async ({ pageParam }) => {
      const rows = await projectQuery<Row>(
        input.projectId,
        query,
        {
          hours: input.days * 24,
          version: input.version,
          route: input.route,
          status: input.status,
          occurrenceLimit: pageSize,
          cursorStartedAt: pageParam?.startedAt ?? "",
          cursorTraceId: pageParam?.traceId ?? "",
        },
      );
      const items = rows.map(
        (row): ErrorOccurrence => ({
          traceId: row.trace_id,
          ts: row.started_at,
          durationMs: Number(row.root_duration_ms),
        }),
      );
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          items.length === pageSize && last
            ? { startedAt: last.ts, traceId: last.traceId }
            : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function errorOccurrenceDetailQueryOptions(input: {
  projectId: string;
  occurrence: ErrorOccurrence;
  version: string;
  route: string;
  status: number;
}) {
  return projectQueryOptions<
    {
      kind: "event" | "span";
      id: string;
      parent_span_id: string;
      name: string;
      ts: string;
      start_ms: string;
      duration_ms: string;
      has_error: string;
      severity: string;
      error_code: string;
      error_message: string;
      attrs: string;
    },
    ErrorOccurrenceDetail
  >(
    "error-occurrence-detail",
    {
      projectId: input.projectId,
      query: `SELECT 'span' AS kind,
       span_id AS id, parent_span_id, name, ts, start_ms,
       duration_ms, has_error, '' AS severity,
       error_code, error_message, attrs
FROM (
  SELECT SpanId AS span_id, ParentSpanId AS parent_span_id,
         SpanName AS name, Timestamp AS ts,
         toUnixTimestamp64Milli(Timestamp) AS start_ms,
         Duration / 1000000 AS duration_ms,
         StatusCode = 'Error' AS has_error,
         '' AS error_code, '' AS error_message,
         toJSONString(${SAFE_SPAN_ATTRIBUTES_SQL}) AS attrs
  FROM otel_traces
  WHERE TraceId = {trace: String}
  ORDER BY Timestamp DESC
  LIMIT 1 BY SpanId
  LIMIT 256
)
UNION ALL
SELECT 'event' AS kind,
       concat(toString(start_ms), ':', event_name) AS id,
       '' AS parent_span_id, event_name AS name, ts, start_ms,
       0 AS duration_ms, false AS has_error, severity,
       error_code, error_message, attrs
FROM (
  ${correlatedRequestLogSql({ includeErrorSummary: true })}
)
ORDER BY ts ASC, kind ASC, id ASC`,
      params: {
        trace: input.occurrence.traceId,
        ...requestLogCorrelationParams({
          ...input.occurrence,
          version: input.version,
          route: input.route,
          status: input.status,
        }),
      },
    },
    (rows) => {
      const spans: ErrorOccurrenceSpan[] = [];
      let log: ErrorOccurrenceLog | null = null;
      for (const row of rows) {
        if (row.kind === "span") {
          spans.push({
            spanId: row.id,
            parentSpanId: row.parent_span_id || null,
            name: row.name,
            ts: row.ts,
            startMs: Number(row.start_ms),
            durationMs: Number(row.duration_ms),
            hasError: row.has_error === "1" || row.has_error === "true",
            attrs: parseTelemetryAttributes(row.attrs),
          });
        } else if (log === null) {
          log = {
            ts: row.ts,
            startMs: Number(row.start_ms),
            eventName: row.name,
            severity: row.severity || "INFO",
            errorBody: requestLogErrorBody(row),
            attrs: parseTelemetryAttributes(row.attrs),
          };
        }
      }
      return { spans, log };
    },
  );
}
