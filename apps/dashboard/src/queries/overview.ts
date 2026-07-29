import { projectQueryOptions } from "@/utils/project-query";

/**
 * Queries the overview needs that the daily rollup cannot serve, because they
 * key on dimensions the rollup deliberately does not carry:
 *
 * - the outreach list is per *consumer*, which is unbounded cardinality and so
 *   is never a rollup dimension;
 * - the version-correlated error comparison is per *status*, likewise;
 * - ingest freshness is a `max(Timestamp)` on raw rows — a rollup keyed on
 *   `toDate(Timestamp)` cannot tell "an hour ago" from "23 hours ago".
 *
 * Each is bounded at the source (a LIMIT, a HAVING floor, or a single-row
 * aggregate) so none of them degrades into a scan-and-serialize.
 */

/** Route+version pairs need this much traffic before a rate means anything. */
export const MIN_SIGNATURE_REQUESTS = 50;

// ---------------------------------------------------------------------------
// 04 — Is the breakage version-correlated?

export interface RouteVersionErrors {
  route: string;
  version: string;
  requests: number;
  errors: number;
  errorRate: number;
}

/**
 * A version's error rate on a route, next to the *same route's* rate on the
 * current version. Comparing a version's overall rate against the project's
 * would mostly measure which routes that version's clients happen to call;
 * holding the route fixed is what isolates the version as the variable.
 */
export interface VersionErrorLift {
  route: string;
  version: string;
  requests: number;
  errors: number;
  errorRate: number;
  /** The same route's error rate on `current`. */
  baselineRate: number;
  /** errorRate / baselineRate. Infinity when current fails on this route zero times. */
  lift: number;
}

export function rankVersionCorrelatedErrors(
  rows: readonly RouteVersionErrors[],
  current: string | null,
  limit = 5,
): VersionErrorLift[] {
  if (!current) return [];
  const baseline = new Map(
    rows
      .filter((row) => row.version === current)
      .map((row) => [row.route, row] as const),
  );

  return rows
    .filter(
      (row) =>
        row.version !== current &&
        row.errors > 0 &&
        row.requests >= MIN_SIGNATURE_REQUESTS,
    )
    .flatMap((row) => {
      const base = baseline.get(row.route);
      // No current-version traffic on this route means there is nothing to
      // attribute the difference to — it could be the version or it could be
      // that only old clients call this endpoint. Say nothing rather than
      // claim a lift against a denominator that does not exist.
      if (!base || base.requests < MIN_SIGNATURE_REQUESTS) return [];
      return [
        {
          route: row.route,
          version: row.version,
          requests: row.requests,
          errors: row.errors,
          errorRate: row.errorRate,
          baselineRate: base.errorRate,
          lift:
            base.errorRate > 0
              ? row.errorRate / base.errorRate
              : row.errorRate > 0
                ? Number.POSITIVE_INFINITY
                : 0,
        },
      ];
    })
    .filter((row) => row.lift > 1)
    .toSorted(
      (left, right) =>
        right.lift - left.lift ||
        right.errors - left.errors ||
        left.route.localeCompare(right.route),
    )
    .slice(0, limit);
}

export function routeVersionErrorsQueryOptions(input: {
  projectId: string;
  days: number;
  limit?: number;
}) {
  return projectQueryOptions<
    { route: string; version: string; requests: string; errors: string },
    RouteVersionErrors[]
  >(
    "route-version-errors",
    {
      projectId: input.projectId,
      // Numerator and denominator come from the same unsampled table, so the
      // rate is a rate. Traces head-sample at 10% and cannot produce one.
      query: `SELECT route, version, requests, errors
FROM (
  WITH LogAttributes['versionless.route'] AS route,
       LogAttributes['versionless.version'] AS version,
       toUInt16OrZero(LogAttributes['http.response.status_code']) AS status
  SELECT route,
         version,
         count() AS requests,
         countIf(status >= 400) AS errors
  FROM otel_logs
  PREWHERE Timestamp >= now() - INTERVAL {days: UInt16} DAY
       AND EventName = 'versionless.request'
  WHERE notEmpty(route)
  GROUP BY route, version
  HAVING requests >= {minRequests: UInt32}
)
ORDER BY errors DESC, requests DESC
LIMIT {limit: UInt16}`,
      params: {
        days: input.days,
        limit: input.limit ?? 300,
        minRequests: MIN_SIGNATURE_REQUESTS,
      },
    },
    (rows) =>
      rows.map((row) => {
        const requests = Number(row.requests);
        const errors = Number(row.errors);
        return {
          route: row.route,
          version: row.version,
          requests,
          errors,
          errorRate: requests > 0 ? errors / requests : 0,
        };
      }),
  );
}

// ---------------------------------------------------------------------------
// 07 — Who is my migration outreach list?

export interface OutreachConsumer {
  /** Opaque `c_`-prefixed fingerprint; the raw key never leaves the SDK. */
  consumerKey: string;
  /** The version this consumer sends most often. */
  version: string;
  versions: number;
  requests: number;
  avgDepth: number;
  lastSeen: string;
}

/**
 * Top consumers by volume, each with the version they actually pin, how much
 * transform work their calls cost, and how recently they called. This is the
 * email list for a migration campaign, so it is ordered by who matters most
 * and bounded — a project has unbounded consumers and a page shows a handful.
 */
export function outreachQueryOptions(input: {
  projectId: string;
  days: number;
  limit?: number;
}) {
  return projectQueryOptions<
    {
      consumer_key: string;
      version: string;
      versions: string;
      requests: string;
      avg_depth: string;
      last_seen: string;
    },
    OutreachConsumer[]
  >(
    "outreach-consumers",
    {
      projectId: input.projectId,
      // `argMax(version, Timestamp)` is the version they are on *now*, which is
      // what an outreach email needs — not the modal version across the window,
      // which would still name the old one the day after they migrate.
      query: `WITH LogAttributes['versionless.consumer.key'] AS raw_consumer_key,
     LogAttributes['versionless.version'] AS requested_version,
     toUInt8OrZero(LogAttributes['versionless.transform_count']) AS depth,
     if(
       empty(raw_consumer_key),
       'anonymous',
       raw_consumer_key
     ) AS consumer_key
SELECT consumer_key,
       argMax(requested_version, Timestamp) AS version,
       uniq(requested_version) AS versions,
       count() AS requests,
       avg(depth) AS avg_depth,
       max(Timestamp) AS last_seen
FROM otel_logs
PREWHERE Timestamp >= now() - INTERVAL {days: UInt16} DAY
     AND EventName = 'versionless.request'
GROUP BY consumer_key
ORDER BY requests DESC, consumer_key ASC
LIMIT {limit: UInt16}`,
      params: { days: input.days, limit: input.limit ?? 25 },
    },
    (rows) =>
      rows.map((row) => ({
        consumerKey: row.consumer_key,
        version: row.version,
        versions: Number(row.versions),
        requests: Number(row.requests),
        avgDepth: Number(row.avg_depth),
        lastSeen: row.last_seen,
      })),
  );
}

// ---------------------------------------------------------------------------
// 09 — Is telemetry even flowing?

export interface IngestFreshness {
  /** Newest request log in the retention window, or null when there are none. */
  lastEventAt: string | null;
  /** Requests in the last hour and the hour before it, for a stalled read. */
  lastHour: number;
  priorHour: number;
}

export type IngestState = "live" | "quiet" | "stale" | "silent";

/**
 * A dashboard that shows a flat green line because ingest broke is worse than
 * one that shows an error, so freshness is graded rather than assumed.
 *
 * `quiet` and `stale` are deliberately different: a low-traffic API with no
 * requests this hour is working correctly, while one that was busy an hour ago
 * and silent since has almost certainly lost its exporter.
 */
export function ingestState(
  freshness: IngestFreshness,
  now: Date,
): { state: IngestState; minutesSince: number | null } {
  if (!freshness.lastEventAt) return { state: "silent", minutesSince: null };
  const iso = freshness.lastEventAt.includes("T")
    ? freshness.lastEventAt
    : `${freshness.lastEventAt.replace(" ", "T")}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return { state: "silent", minutesSince: null };
  }
  const minutesSince = Math.max(
    0,
    Math.round((now.getTime() - parsed.getTime()) / 60_000),
  );
  if (minutesSince <= 15) return { state: "live", minutesSince };
  if (minutesSince <= 120) {
    // Busy before, silent now — that reads as a broken exporter, not a lull.
    return {
      state: freshness.priorHour > 0 && freshness.lastHour === 0
        ? "stale"
        : "quiet",
      minutesSince,
    };
  }
  return { state: "stale", minutesSince };
}

export function ingestFreshnessQueryOptions(input: { projectId: string }) {
  return projectQueryOptions<
    { last_event_at: string; last_hour: string; prior_hour: string },
    IngestFreshness
  >(
    "ingest-freshness",
    {
      projectId: input.projectId,
      // One row, two hours of rows scanned. Kept off the rollup on purpose: a
      // daily grain cannot distinguish "an hour ago" from "this morning".
      query: `SELECT max(Timestamp) AS last_event_at,
       countIf(Timestamp >= now() - INTERVAL 1 HOUR) AS last_hour,
       countIf(Timestamp >= now() - INTERVAL 2 HOUR
               AND Timestamp < now() - INTERVAL 1 HOUR) AS prior_hour
FROM otel_logs
PREWHERE Timestamp >= now() - INTERVAL 2 HOUR
     AND EventName = 'versionless.request'`,
    },
    (rows) => {
      const row = rows[0];
      // ClickHouse returns the zero DateTime for max() over no rows.
      const raw = row?.last_event_at ?? "";
      return {
        lastEventAt: raw.startsWith("1970-01-01") || raw === "" ? null : raw,
        lastHour: Number(row?.last_hour ?? 0),
        priorHour: Number(row?.prior_hour ?? 0),
      };
    },
  );
}
