import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { projectQueryOptions } from "@/utils/project-query";

export type InsightsSortDirection = "asc" | "desc";
export type VersionSort =
  | "version"
  | "clients"
  | "requests"
  | "lastSeen"
  | "sunsetAfter";
export type SunsetBlockerSort =
  | "consumer"
  | "route"
  | "version"
  | "requests"
  | "lastSeen";
export type TransformDepthSort =
  | "route"
  | "avg"
  | "p95"
  | "max"
  | "requests";

export interface AdoptionPoint {
  bucket: string;
  version: string;
  clients: number;
  requests: number;
}

export interface VersionSummary {
  version: string;
  clients: number;
  requests: number;
  lastSeen: string | null;
  sunsetAfter: string | null;
}

export interface SunsetBlocker {
  consumerKey: string;
  route: string;
  version: string;
  requests: number;
  lastSeen: string;
}

export interface DriftRow {
  route: string;
  avgDepth: number;
  maxDepth: number;
  p95Depth: number;
  requests: number;
}

export interface VersionRouteAnalytics {
  route: string;
  clients: number;
  requests: number;
  avgDepth: number;
  p95Depth: number;
  lastSeen: string;
}

/**
 * Consumer keys are opaque per-caller fingerprints (`c_` + 12 hex), so their
 * cardinality is unbounded by construction — `uniqExact` would hold every
 * distinct key in memory for the window. `uniq` is approximate within ~1% and
 * bounded, which is the right trade for a "how many callers" figure.
 */
const VERSION_SQL = `SELECT LogAttributes['versionless.version'] AS version,
       uniq(if(empty(LogAttributes['versionless.consumer.key']), 'anonymous', LogAttributes['versionless.consumer.key'])) AS clients,
       count() AS requests,
       max(Timestamp) AS last_seen
FROM otel_logs
WHERE EventName = 'versionless.request'
  AND Timestamp >= now() - INTERVAL {days: UInt16} DAY
GROUP BY version`;

export function compareNullable(
  left: string | number | null,
  right: string | number | null,
  direction: InsightsSortDirection,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const compared =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));
  return direction === "asc" ? compared : -compared;
}

export interface ProjectRelease {
  version: string;
  after: string;
  message: string | null;
}

/**
 * The binding retirement date for a version: a sunset on X covers every
 * version <= X, and when several apply the earliest cutoff wins — the same
 * rule core's `SunsetGate` enforces on the wire (`packages/core/src/sunset.ts`).
 */
export function sunsetFor(
  version: string,
  sunsets: readonly ProjectRelease[],
): string | null {
  let binding: string | null = null;
  for (const sunset of sunsets) {
    if (version > sunset.version) continue;
    if (binding === null || sunset.after < binding) binding = sunset.after;
  }
  return binding;
}

/**
 * Versions with an uploaded contract are unioned in so a released-but-unused
 * version still appears — a version with zero traffic is exactly the one a
 * user wants to see before retiring it. Without an uploaded snapshot the list
 * is traffic only, which is honest: we know what clients ask for, not what the
 * API declares.
 */
export function presentVersions(
  rows: Array<{
    version: string;
    clients: string;
    requests: string;
    last_seen: string;
  }>,
  releases: {
    versions?: readonly string[];
    sunsets?: readonly ProjectRelease[];
  } = {},
): VersionSummary[] {
  const byVersion = new Map(rows.map((row) => [row.version, row]));
  const sunsets = releases.sunsets ?? [];
  return [
    ...new Set([...(releases.versions ?? []), ...rows.map((row) => row.version)]),
  ].map((version) => {
    const row = byVersion.get(version);
    return {
      version,
      clients: row ? Number(row.clients) : 0,
      requests: row ? Number(row.requests) : 0,
      lastSeen: row?.last_seen ?? null,
      sunsetAfter: sunsetFor(version, sunsets),
    };
  });
}

export function sortVersions(
  versions: VersionSummary[],
  sort: VersionSort,
  direction: InsightsSortDirection,
): VersionSummary[] {
  return versions.toSorted((left, right) => {
    if (sort === "sunsetAfter" && left.sunsetAfter !== right.sunsetAfter) {
      if (left.sunsetAfter === null) return direction === "asc" ? 1 : -1;
      if (right.sunsetAfter === null) return direction === "asc" ? -1 : 1;
    }
    const compared = compareNullable(left[sort], right[sort], direction);
    return compared || right.version.localeCompare(left.version);
  });
}

/**
 * Release metadata is uploaded by `versionless snapshot`, so it arrives from
 * tRPC rather than ClickHouse and is folded in here. It is part of the query
 * key: a snapshot upload that adds a sunset must invalidate the cached rows
 * rather than leave a stale "no sunset" verdict on screen.
 */
export function versionAggregationQueryOptions(
  projectId: string,
  days = 30,
  releases: {
    versions?: readonly string[];
    sunsets?: readonly ProjectRelease[];
  } = {},
) {
  return {
    ...projectQueryOptions(
      "versions",
      {
        projectId,
        query: VERSION_SQL,
        params: { days },
        keyExtra: {
          versions: releases.versions ?? [],
          sunsets: releases.sunsets ?? [],
        },
      },
      (rows: Array<{
        version: string;
        clients: string;
        requests: string;
        last_seen: string;
      }>) => presentVersions(rows, releases),
    ),
    staleTime: 30_000,
  };
}

export function adoptionQueryOptions(projectId: string, days: number) {
  const bucketExpression =
    days === 1 ? "toStartOfHour(Timestamp)" : "toStartOfDay(Timestamp)";

  return projectQueryOptions<
    { bucket: string; version: string; clients: string; requests: string },
    AdoptionPoint[]
  >(
    "adoption",
    {
      projectId,
      query: `SELECT ${bucketExpression} AS bucket,
       LogAttributes['versionless.version'] AS version,
       uniq(if(empty(LogAttributes['versionless.consumer.key']), 'anonymous', LogAttributes['versionless.consumer.key'])) AS clients,
       count() AS requests
FROM otel_logs
WHERE EventName = 'versionless.request'
  AND Timestamp >= now() - INTERVAL {days: UInt16} DAY
GROUP BY bucket, version
ORDER BY bucket ASC, version ASC`,
      params: { days },
    },
    (rows) =>
      rows.map((row) => ({
        bucket: row.bucket,
        version: row.version,
        clients: Number(row.clients),
        requests: Number(row.requests),
      })),
  );
}

export function versionsQueryOptions(
  projectId: string,
  days = 30,
  sort: VersionSort = "version",
  direction: InsightsSortDirection = "desc",
  releases: {
    versions?: readonly string[];
    sunsets?: readonly ProjectRelease[];
  } = {},
) {
  const aggregation = versionAggregationQueryOptions(projectId, days, releases);
  return queryOptions({
    ...aggregation,
    select: (versions) => sortVersions(versions, sort, direction),
  });
}

export function versionPagesQueryOptions(
  queryClient: QueryClient,
  input: {
    projectId: string;
    days: number;
    sort: VersionSort;
    direction: InsightsSortDirection;
    limit: number;
    releases?: {
      versions?: readonly string[];
      sunsets?: readonly ProjectRelease[];
    };
  },
) {
  type Page = { items: VersionSummary[]; nextCursor: number | undefined };
  type Key = readonly ["project-query", "version-pages", typeof input];
  return infiniteQueryOptions<Page, Error, InfiniteData<Page, number>, Key, number>({
    queryKey: ["project-query", "version-pages", input],
    initialPageParam: 0,
    enabled: input.projectId !== "",
    retry: false,
    queryFn: async ({ pageParam }) => {
      const aggregation = versionAggregationQueryOptions(
        input.projectId,
        input.days,
        input.releases ?? {},
      );
      const versions =
        pageParam === 0
          ? await queryClient.fetchQuery(aggregation)
          : await queryClient.ensureQueryData(aggregation);
      const summaries = sortVersions(
        versions,
        input.sort,
        input.direction,
      );
      const items = summaries.slice(pageParam, pageParam + input.limit);
      return {
        items,
        nextCursor:
          pageParam + items.length < summaries.length
            ? pageParam + items.length
            : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

const sunsetSortKeys = {
  consumer: "consumerKey",
  route: "route",
  version: "version",
  requests: "requests",
  lastSeen: "lastSeen",
} satisfies Record<SunsetBlockerSort, keyof SunsetBlocker>;

const driftSortKeys = {
  route: "route",
  avg: "avgDepth",
  p95: "p95Depth",
  max: "maxDepth",
  requests: "requests",
} satisfies Record<TransformDepthSort, keyof DriftRow>;

function sortSunsetBlockers(
  blockers: SunsetBlocker[],
  sort: SunsetBlockerSort,
  direction: InsightsSortDirection,
): SunsetBlocker[] {
  const key = sunsetSortKeys[sort];
  return blockers.toSorted(
    (left, right) =>
      compareNullable(left[key], right[key], direction) ||
      left.consumerKey.localeCompare(right.consumerKey) ||
      left.route.localeCompare(right.route) ||
      left.version.localeCompare(right.version),
  );
}

function sortDriftRows(
  rows: DriftRow[],
  sort: TransformDepthSort,
  direction: InsightsSortDirection,
): DriftRow[] {
  const key = driftSortKeys[sort];
  return rows.toSorted(
    (left, right) =>
      compareNullable(left[key], right[key], direction) ||
      left.route.localeCompare(right.route),
  );
}

export function sunsetBlockersQueryOptions(input: {
  projectId: string;
  version: string;
  sort: SunsetBlockerSort;
  direction: InsightsSortDirection;
}) {
  // The SQL order is fixed so sort clicks reorder the cached rows client-side
  // instead of re-running the aggregation (same pattern as versionsQueryOptions).
  return queryOptions({
    ...projectQueryOptions<
      {
        consumer_key: string;
        route: string;
        version: string;
        requests: string;
        last_seen: string;
      },
      SunsetBlocker[]
    >(
      "sunset-blockers",
      {
        projectId: input.projectId,
        query: `SELECT if(empty(LogAttributes['versionless.consumer.key']), 'anonymous', LogAttributes['versionless.consumer.key']) AS consumer_key,
       LogAttributes['versionless.route'] AS route,
       LogAttributes['versionless.version'] AS version,
       count() AS requests,
       max(Timestamp) AS last_seen
FROM otel_logs
WHERE EventName = 'versionless.request'
  AND LogAttributes['versionless.version'] <= {sunset: String}
  AND Timestamp >= now() - INTERVAL 30 DAY
GROUP BY consumer_key, route, version
ORDER BY requests DESC, consumer_key ASC, route ASC, version ASC
LIMIT 200`,
        params: { sunset: input.version },
      },
      (rows) =>
        rows.map((row) => ({
          consumerKey: row.consumer_key,
          route: row.route,
          version: row.version,
          requests: Number(row.requests),
          lastSeen: row.last_seen,
        })),
    ),
    select: (blockers) =>
      sortSunsetBlockers(blockers, input.sort, input.direction),
  });
}

export function transformDepthQueryOptions(input: {
  projectId: string;
  days: number;
  sort: TransformDepthSort;
  direction: InsightsSortDirection;
}) {
  // The SQL order is fixed so sort clicks reorder the cached rows client-side
  // instead of re-running the aggregation (same pattern as versionsQueryOptions).
  return queryOptions({
    ...projectQueryOptions<
      {
        route: string;
        avg_depth: number;
        max_depth: number;
        p95_depth: number;
        requests: string;
      },
      DriftRow[]
    >(
      "transform-depth",
      {
        projectId: input.projectId,
        query: `WITH LogAttributes['versionless.route'] AS route,
     toUInt8OrZero(LogAttributes['versionless.transform_count']) AS depth
SELECT route,
       avg(depth) AS avg_depth,
       max(depth) AS max_depth,
       quantileTDigest(0.95)(depth) AS p95_depth,
       count() AS requests
FROM otel_logs
PREWHERE Timestamp >= now() - INTERVAL {days: UInt16} DAY
WHERE EventName = 'versionless.request' AND notEmpty(route)
GROUP BY route
ORDER BY route ASC`,
        params: { days: input.days },
      },
      (rows) =>
        rows.map((row) => ({
          route: row.route,
          avgDepth: Number(row.avg_depth),
          maxDepth: Number(row.max_depth),
          p95Depth: Number(row.p95_depth),
          requests: Number(row.requests),
        })),
    ),
    select: (rows) => sortDriftRows(rows, input.sort, input.direction),
  });
}

export function selectTransformDepthChartRows(
  rows: DriftRow[],
  limit = 16,
): DriftRow[] {
  return rows
    .toSorted(
      (left, right) =>
        right.requests - left.requests ||
        right.p95Depth - left.p95Depth ||
        left.route.localeCompare(right.route),
    )
    .slice(0, limit);
}

export function versionRouteAnalyticsQueryOptions(input: {
  projectId: string;
  version: string;
  days: number;
}) {
  return projectQueryOptions<
    {
      route: string;
      clients: string;
      requests: string;
      avg_depth: number;
      p95_depth: number;
      last_seen: string;
    },
    VersionRouteAnalytics[]
  >(
    "version-route-analytics",
    {
      projectId: input.projectId,
      query: `SELECT LogAttributes['versionless.route'] AS route,
       uniq(if(empty(LogAttributes['versionless.consumer.key']), 'anonymous', LogAttributes['versionless.consumer.key'])) AS clients,
       count() AS requests,
       avg(toUInt16OrZero(LogAttributes['versionless.transform_count'])) AS avg_depth,
       quantile(0.95)(toUInt16OrZero(LogAttributes['versionless.transform_count'])) AS p95_depth,
       max(Timestamp) AS last_seen
FROM otel_logs
WHERE EventName = 'versionless.request'
  AND LogAttributes['versionless.version'] = {version: String}
  AND Timestamp >= now() - INTERVAL {days: UInt16} DAY
GROUP BY route
ORDER BY requests DESC, route ASC
LIMIT 100`,
      params: { version: input.version, days: input.days },
    },
    (rows) =>
      rows.map((row) => ({
        route: row.route,
        clients: Number(row.clients),
        requests: Number(row.requests),
        avgDepth: Number(row.avg_depth),
        p95Depth: Number(row.p95_depth),
        lastSeen: row.last_seen,
      })),
  );
}
