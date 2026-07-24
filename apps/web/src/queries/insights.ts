import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { KNOWN_VERSIONS, SUNSETS } from "demo/releases";

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

const VERSION_SQL = `SELECT LogAttributes['versionless.version'] AS version,
       uniqExact(if(empty(LogAttributes['versionless.consumer.key']), 'anonymous', LogAttributes['versionless.consumer.key'])) AS clients,
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

function presentVersions(
  rows: Array<{
    version: string;
    clients: string;
    requests: string;
    last_seen: string;
  }>,
): VersionSummary[] {
  const byVersion = new Map(rows.map((row) => [row.version, row]));
  return [...new Set([...KNOWN_VERSIONS, ...rows.map((row) => row.version)])]
    .map((version) => {
      const row = byVersion.get(version);
      const sunset = SUNSETS.find((candidate) => version <= candidate.version);
      return {
        version,
        clients: row ? Number(row.clients) : 0,
        requests: row ? Number(row.requests) : 0,
        lastSeen: row?.last_seen ?? null,
        sunsetAfter: sunset?.after ?? null,
      };
    });
}

function sortVersions(
  versions: VersionSummary[],
  sort: VersionSort,
  direction: InsightsSortDirection,
): VersionSummary[] {
  return versions.toSorted((left, right) => {
    const compared = compareNullable(left[sort], right[sort], direction);
    return compared || right.version.localeCompare(left.version);
  });
}

export function versionAggregationQueryOptions(
  projectId: string,
  days = 30,
) {
  return {
    ...projectQueryOptions(
      "versions",
      { projectId, query: VERSION_SQL, params: { days } },
      (rows: Array<{
        version: string;
        clients: string;
        requests: string;
        last_seen: string;
      }>) => presentVersions(rows),
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
       uniqExact(if(empty(LogAttributes['versionless.consumer.key']), 'anonymous', LogAttributes['versionless.consumer.key'])) AS clients,
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
) {
  const aggregation = versionAggregationQueryOptions(projectId, days);
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
        query: `SELECT LogAttributes['versionless.route'] AS route,
       avg(toUInt16OrZero(LogAttributes['versionless.transform_count'])) AS avg_depth,
       max(toUInt16OrZero(LogAttributes['versionless.transform_count'])) AS max_depth,
       quantile(0.95)(toUInt16OrZero(LogAttributes['versionless.transform_count'])) AS p95_depth,
       count() AS requests
FROM otel_logs
WHERE EventName = 'versionless.request'
  AND Timestamp >= now() - INTERVAL {days: UInt16} DAY
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
