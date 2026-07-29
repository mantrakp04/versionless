import { projectQueryOptions } from "@/utils/project-query";

/**
 * Latency lives on every request log record as `versionless.latency_ms`, so
 * these read the same unsampled table the error counts do. Quantiles use
 * `quantilesTDigest`, which is mergeable and bounded in memory — a plain
 * `quantile` over a high-cardinality window is neither.
 */

export interface LatencyQuantiles {
  p50: number;
  p95: number;
  p99: number;
  requests: number;
}

/** Latency at a given transform depth — the version-cost relationship. */
export interface LatencyByDepth extends LatencyQuantiles {
  depth: number;
}

export interface LatencyOverview {
  overall: LatencyQuantiles;
  byDepth: LatencyByDepth[];
  /**
   * Milliseconds of p95 added per transform, from a least-squares fit across
   * depths. Null when fewer than two depths carry enough traffic to fit.
   */
  msPerTransform: number | null;
}

interface LatencyRow {
  row_kind: "overall" | "depth";
  depth: string;
  p50: string;
  p95: string;
  p99: string;
  requests: string;
}

/** Depths below this carry too little traffic for a stable quantile. */
const MIN_DEPTH_SAMPLE = 30;

const LATENCY_SQL = `SELECT if(grouping_depth = 1, 'overall', 'depth') AS row_kind,
       depth,
       quantiles[1] AS p50,
       quantiles[2] AS p95,
       quantiles[3] AS p99,
       requests
FROM (
  SELECT toUInt8OrZero(LogAttributes['versionless.transform_count']) AS depth,
         grouping(depth) AS grouping_depth,
         quantilesTDigest(0.5, 0.95, 0.99)(
           toFloat64OrZero(LogAttributes['versionless.latency_ms'])
         ) AS quantiles,
         count() AS requests
  FROM otel_logs
  PREWHERE Timestamp >= now() - INTERVAL {days: UInt16} DAY
       AND EventName = 'versionless.request'
  GROUP BY GROUPING SETS ((depth), ())
)
ORDER BY row_kind ASC, depth ASC`;

/**
 * Least-squares slope of p95 over depth, weighted by request volume so a
 * near-empty depth bucket can't dominate the fit.
 */
function fitMsPerTransform(rows: LatencyByDepth[]): number | null {
  const usable = rows.filter((row) => row.requests >= MIN_DEPTH_SAMPLE);
  if (usable.length < 2) return null;

  const weight = usable.reduce((total, row) => total + row.requests, 0);
  if (weight === 0) return null;

  const meanDepth =
    usable.reduce((total, row) => total + row.depth * row.requests, 0) / weight;
  const meanP95 =
    usable.reduce((total, row) => total + row.p95 * row.requests, 0) / weight;

  let covariance = 0;
  let variance = 0;
  for (const row of usable) {
    const dx = row.depth - meanDepth;
    covariance += row.requests * dx * (row.p95 - meanP95);
    variance += row.requests * dx * dx;
  }
  if (variance === 0) return null;
  return covariance / variance;
}

export function latencyOverviewQueryOptions(input: {
  projectId: string;
  days: number;
}) {
  return projectQueryOptions<LatencyRow, LatencyOverview>(
    "latency-overview",
    {
      projectId: input.projectId,
      query: LATENCY_SQL,
      params: { days: input.days },
    },
    (rows) => {
      const toQuantiles = (row: LatencyRow | undefined): LatencyQuantiles => ({
        p50: Number(row?.p50 ?? 0),
        p95: Number(row?.p95 ?? 0),
        p99: Number(row?.p99 ?? 0),
        requests: Number(row?.requests ?? 0),
      });

      const byDepth = rows
        .filter((row) => row.row_kind === "depth")
        .map((row) => ({ depth: Number(row.depth), ...toQuantiles(row) }))
        .toSorted((left, right) => left.depth - right.depth);

      return {
        overall: toQuantiles(rows.find((row) => row.row_kind === "overall")),
        byDepth,
        msPerTransform: fitMsPerTransform(byDepth),
      };
    },
  );
}

export interface RouteLatency extends LatencyQuantiles {
  route: string;
  version: string;
  avgDepth: number;
}

/**
 * Slowest route+version pairs. Bounded to a top-N by p95 so a wide route table
 * can't turn this into an unbounded scan-and-serialize.
 */
export function slowestRoutesQueryOptions(input: {
  projectId: string;
  days: number;
  limit?: number;
}) {
  return projectQueryOptions<
    {
      route: string;
      version: string;
      avg_depth: string;
      p50: string;
      p95: string;
      p99: string;
      requests: string;
    },
    RouteLatency[]
  >(
    "slowest-routes",
    {
      projectId: input.projectId,
      query: `SELECT route, version, avg_depth,
       quantiles[1] AS p50, quantiles[2] AS p95, quantiles[3] AS p99,
       requests
FROM (
  WITH LogAttributes['versionless.route'] AS route,
       LogAttributes['versionless.version'] AS version,
       toUInt8OrZero(LogAttributes['versionless.transform_count']) AS depth,
       toFloat64OrZero(LogAttributes['versionless.latency_ms']) AS latency_ms
  SELECT route,
         version,
         avg(depth) AS avg_depth,
         quantilesTDigest(0.5, 0.95, 0.99)(latency_ms) AS quantiles,
         count() AS requests
  FROM otel_logs
  PREWHERE Timestamp >= now() - INTERVAL {days: UInt16} DAY
       AND EventName = 'versionless.request'
  WHERE notEmpty(route)
  GROUP BY route, version
  HAVING requests >= {minRequests: UInt32}
)
ORDER BY p95 DESC
LIMIT {limit: UInt16}`,
      params: {
        days: input.days,
        limit: input.limit ?? 10,
        minRequests: MIN_DEPTH_SAMPLE,
      },
    },
    (rows) =>
      rows.map((row) => ({
        route: row.route,
        version: row.version,
        avgDepth: Number(row.avg_depth),
        p50: Number(row.p50),
        p95: Number(row.p95),
        p99: Number(row.p99),
        requests: Number(row.requests),
      })),
  );
}
