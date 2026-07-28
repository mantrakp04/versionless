import { projectQueryOptions } from "@/utils/project-query";

/**
 * Overview queries read `versionless_rollup_daily` — one pre-aggregated row per
 * (tenant, day, version, route, method) — instead of scanning raw request logs.
 * The overview shows nine panels at once, which against raw rows is nine
 * concurrent full scans of the retention window per page load.
 *
 * The rollup stores *states*, not finalized values: `quantilesTDigestMerge` and
 * `uniqMerge` combine daily rows into a window figure. Finalized daily
 * quantiles could not be re-combined, and summing daily distinct-counts would
 * count a consumer once per day it appeared.
 *
 * Anything the rollup does not key on — a specific status code, a consumer, an
 * individual trace — stays a raw drill-down.
 */

/** Table name, mirrored from `queryAccessStatements` in `@versionless/api`. */
export const ROLLUP_TABLE = "versionless_rollup_daily";

/** Tenancy is enforced by a row policy on the rollup's own columns. */
const WINDOW = `FROM ${ROLLUP_TABLE}
WHERE day >= today() - {days: UInt16}`;

/**
 * Every rollup query aggregates in an inner SELECT whose aliases are prefixed,
 * then renames in an outer one.
 *
 * ClickHouse resolves an identifier against the SELECT's own aliases before the
 * table's columns. `sum(requests) AS requests` beside
 * `sum(depth_sum) / sum(requests)` therefore expands the second reference to
 * `sum(sum(requests))`, and the server rejects the whole query: "Aggregate
 * function sum(requests) AS requests is found inside another aggregate
 * function." Prefixing the inner aliases means no alias shares a name with a
 * column, so nothing can capture a later reference.
 *
 * The division stays outside the aggregation deliberately: `avg(depth_sum /
 * requests)` would weight a rollup row with nine requests the same as one with
 * nine million. Depth per request is a ratio of sums, not a mean of ratios.
 */
const AVG_DEPTH = `t_depth_sum / greatest(t_requests, 1) AS avg_depth`;

export interface RollupTotals {
  requests: number;
  errors: number;
  errorRate: number;
  consumers: number;
  p50: number;
  p95: number;
  p99: number;
  avgDepth: number;
  maxDepth: number;
  /** Requests whose served version differed from the one requested. */
  negotiated: number;
  /**
   * Requests whose version source was recorded at all. Rollup days written
   * before the source attribute shipped carry zero, so a share computed over
   * `requests` would read as "0% unpinned" rather than "not recorded".
   */
  sourced: number;
  /** Requests that sent no pin and silently move when `current` changes. */
  unpinned: number;
  /** Requests pinned ahead of the deployed `current` and clamped back to it. */
  clamped: number;
}

interface TotalsRow {
  requests: string;
  errors: string;
  consumers: string;
  p50: string;
  p95: string;
  p99: string;
  avg_depth: string;
  max_depth: string;
  negotiated: string;
  /**
   * Optional because the negotiation columns were added to an existing rollup
   * by `ALTER TABLE`. A server that has not yet run the widening returns rows
   * without them, and `Number(undefined)` is `NaN` — which would propagate into
   * every share on the page rather than reading as "not recorded".
   */
  sourced?: string;
  unpinned?: string;
  clamped?: string;
}

/** `Number(undefined)` is NaN; a missing count is zero. */
function count(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyTotals(): RollupTotals {
  return {
    requests: 0,
    errors: 0,
    errorRate: 0,
    consumers: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    avgDepth: 0,
    maxDepth: 0,
    negotiated: 0,
    sourced: 0,
    unpinned: 0,
    clamped: 0,
  };
}

function presentTotals(row: TotalsRow | undefined): RollupTotals {
  if (!row) return emptyTotals();
  const requests = Number(row.requests);
  const errors = Number(row.errors);
  return {
    requests,
    errors,
    errorRate: requests > 0 ? errors / requests : 0,
    consumers: Number(row.consumers),
    p50: Number(row.p50),
    p95: Number(row.p95),
    p99: Number(row.p99),
    avgDepth: Number(row.avg_depth),
    maxDepth: Number(row.max_depth),
    negotiated: count(row.negotiated),
    sourced: count(row.sourced),
    unpinned: count(row.unpinned),
    clamped: count(row.clamped),
  };
}

/** Headline figures for the window: one rollup scan, no raw rows touched. */
export function rollupTotalsQueryOptions(input: {
  projectId: string;
  days: number;
}) {
  return projectQueryOptions<TotalsRow, RollupTotals>(
    "rollup-totals",
    {
      projectId: input.projectId,
      query: `SELECT t_requests AS requests,
       t_errors AS errors,
       t_consumers AS consumers,
       t_quantiles[1] AS p50,
       t_quantiles[2] AS p95,
       t_quantiles[3] AS p99,
       ${AVG_DEPTH},
       t_max_depth AS max_depth,
       t_negotiated AS negotiated,
       t_sourced AS sourced,
       t_unpinned AS unpinned,
       t_clamped AS clamped
FROM (
  SELECT sum(requests) AS t_requests,
         sum(errors) AS t_errors,
         uniqMerge(consumers) AS t_consumers,
         quantilesTDigestMerge(0.5, 0.95, 0.99)(latency) AS t_quantiles,
         sum(depth_sum) AS t_depth_sum,
         max(depth_max) AS t_max_depth,
         sum(negotiated) AS t_negotiated,
         sum(sourced) AS t_sourced,
         sum(unpinned) AS t_unpinned,
         sum(clamped) AS t_clamped
  ${WINDOW}
)`,
      params: { days: input.days },
    },
    (rows) => presentTotals(rows[0]),
  );
}

export interface RollupDay {
  day: string;
  requests: number;
  errors: number;
  errorRate: number;
  consumers: number;
  p95: number;
  avgDepth: number;
}

/** The daily curve every trended panel plots. Bounded by the day count. */
export function rollupDailyQueryOptions(input: {
  projectId: string;
  days: number;
}) {
  return projectQueryOptions<
    {
      day: string;
      requests: string;
      errors: string;
      consumers: string;
      p95: string;
      avg_depth: string;
    },
    RollupDay[]
  >(
    "rollup-daily",
    {
      projectId: input.projectId,
      query: `SELECT day,
       t_requests AS requests,
       t_errors AS errors,
       t_consumers AS consumers,
       t_p95 AS p95,
       ${AVG_DEPTH}
FROM (
  SELECT day,
         sum(requests) AS t_requests,
         sum(errors) AS t_errors,
         uniqMerge(consumers) AS t_consumers,
         quantilesTDigestMerge(0.95)(latency)[1] AS t_p95,
         sum(depth_sum) AS t_depth_sum
  ${WINDOW}
  GROUP BY day
)
ORDER BY day ASC`,
      params: { days: input.days },
    },
    (rows) =>
      rows.map((row) => {
        const requests = Number(row.requests);
        const errors = Number(row.errors);
        return {
          day: row.day,
          requests,
          errors,
          errorRate: requests > 0 ? errors / requests : 0,
          consumers: Number(row.consumers),
          p95: Number(row.p95),
          avgDepth: Number(row.avg_depth),
        };
      }),
  );
}

/**
 * The overview traffic curve follows the selected window's useful grain.
 * Daily rollups serve multi-day views; the 24-hour view deliberately scans
 * only the last 24 hours of request logs because a daily rollup cannot recover
 * the hourly shape.
 */
export function trafficCurveQueryOptions(input: {
  projectId: string;
  days: number;
}) {
  if (input.days !== 1) return rollupDailyQueryOptions(input);

  return projectQueryOptions<
    {
      day: string;
      requests: string;
      errors: string;
      consumers: string;
      p95: string;
      avg_depth: string;
    },
    RollupDay[]
  >(
    "traffic-curve-hourly",
    {
      projectId: input.projectId,
      query: `SELECT toStartOfHour(Timestamp) AS day,
       count() AS requests,
       countIf(toUInt16OrZero(LogAttributes['http.response.status_code']) >= 400) AS errors,
       uniq(if(empty(LogAttributes['versionless.consumer.key']), 'anonymous', LogAttributes['versionless.consumer.key'])) AS consumers,
       quantileTDigest(0.95)(toFloat64OrZero(LogAttributes['versionless.latency_ms'])) AS p95,
       avg(toUInt8OrZero(LogAttributes['versionless.transform_count'])) AS avg_depth
FROM otel_logs
PREWHERE Timestamp >= now() - INTERVAL {hours: UInt16} HOUR
WHERE EventName = 'versionless.request'
GROUP BY day
ORDER BY day ASC
WITH FILL
  FROM toStartOfHour(now() - INTERVAL 24 HOUR)
  TO toStartOfHour(now()) + INTERVAL 1 HOUR
  STEP INTERVAL 1 HOUR`,
      params: { hours: 24 },
    },
    (rows) =>
      rows.map((row) => {
        const requests = Number(row.requests);
        const errors = Number(row.errors);
        return {
          day: row.day,
          requests,
          errors,
          errorRate: requests > 0 ? errors / requests : 0,
          consumers: Number(row.consumers),
          p95: Number(row.p95),
          avgDepth: Number(row.avg_depth),
        };
      }),
  );
}

export interface RollupVersion {
  version: string;
  requests: number;
  errors: number;
  errorRate: number;
  consumers: number;
  p95: number;
  avgDepth: number;
  lastSeen: string;
}

/**
 * Per-version totals, bounded to a top-N by traffic. A long-lived API
 * accumulates dozens of versions and the overview only ever plots a handful.
 */
export function rollupVersionsQueryOptions(input: {
  projectId: string;
  days: number;
  limit?: number;
}) {
  return projectQueryOptions<
    {
      version: string;
      requests: string;
      errors: string;
      consumers: string;
      p95: string;
      avg_depth: string;
      last_seen: string;
    },
    RollupVersion[]
  >(
    "rollup-versions",
    {
      projectId: input.projectId,
      query: `SELECT version,
       t_requests AS requests,
       t_errors AS errors,
       t_consumers AS consumers,
       t_p95 AS p95,
       ${AVG_DEPTH},
       t_last_seen AS last_seen
FROM (
  SELECT version,
         sum(requests) AS t_requests,
         sum(errors) AS t_errors,
         uniqMerge(consumers) AS t_consumers,
         quantilesTDigestMerge(0.95)(latency)[1] AS t_p95,
         sum(depth_sum) AS t_depth_sum,
         max(day) AS t_last_seen
  ${WINDOW}
  GROUP BY version
)
ORDER BY requests DESC
LIMIT {limit: UInt16}`,
      params: { days: input.days, limit: input.limit ?? 12 },
    },
    (rows) =>
      rows.map((row) => {
        const requests = Number(row.requests);
        const errors = Number(row.errors);
        return {
          version: row.version,
          requests,
          errors,
          errorRate: requests > 0 ? errors / requests : 0,
          consumers: Number(row.consumers),
          p95: Number(row.p95),
          avgDepth: Number(row.avg_depth),
          lastSeen: row.last_seen,
        };
      }),
  );
}
