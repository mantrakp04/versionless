import { describe, expect, test } from "bun:test";

import {
  ingestFreshnessQueryOptions,
  ingestState,
  MIN_SIGNATURE_REQUESTS,
  outreachQueryOptions,
  rankVersionCorrelatedErrors,
  routeVersionErrorsQueryOptions,
  type RouteVersionErrors,
} from "./overview";

const projectId = "11111111-1111-4111-8111-111111111111";

function signature(
  route: string,
  version: string,
  requests: number,
  errors: number,
): RouteVersionErrors {
  return {
    route,
    version,
    requests,
    errors,
    errorRate: requests > 0 ? errors / requests : 0,
  };
}

describe("version-correlated error ranking", () => {
  test("holds the route fixed so the version is the only variable", () => {
    const lifts = rankVersionCorrelatedErrors(
      [
        // Same route, ten times the failure rate on the old version.
        signature("GET /v1/audit-events/:id", "2026-07-24", 10_000, 10),
        signature("GET /v1/audit-events/:id", "2025-08-01", 1_000, 100),
        // Same old version, but this route is fine — so the finding is about
        // the route+version pair, not the version as a whole.
        signature("GET /v1/users/:id", "2026-07-24", 10_000, 10),
        signature("GET /v1/users/:id", "2025-08-01", 1_000, 1),
      ],
      "2026-07-24",
    );

    expect(lifts).toHaveLength(1);
    expect(lifts[0]).toMatchObject({
      route: "GET /v1/audit-events/:id",
      version: "2025-08-01",
      errors: 100,
    });
    expect(lifts[0]!.lift).toBeCloseTo(100, 5);
    expect(lifts[0]!.baselineRate).toBeCloseTo(0.001, 6);
  });

  test("refuses to claim a lift with no current-version traffic to compare against", () => {
    // Only old clients call this route. The difference could be the version or
    // it could be the endpoint; we cannot tell, so we say nothing.
    expect(
      rankVersionCorrelatedErrors(
        [signature("GET /v1/legacy-export", "2025-08-01", 5_000, 500)],
        "2026-07-24",
      ),
    ).toEqual([]);

    // Current is present but too thin to be a denominator.
    expect(
      rankVersionCorrelatedErrors(
        [
          signature("GET /v1/legacy-export", "2026-07-24", 4, 0),
          signature("GET /v1/legacy-export", "2025-08-01", 5_000, 500),
        ],
        "2026-07-24",
      ),
    ).toEqual([]);
  });

  test("ignores signatures too small for a rate to mean anything", () => {
    const thin = MIN_SIGNATURE_REQUESTS - 1;
    expect(
      rankVersionCorrelatedErrors(
        [
          signature("GET /v1/thing", "2026-07-24", 10_000, 10),
          // 1-in-2 looks catastrophic and is one unlucky pair of requests.
          signature("GET /v1/thing", "2025-08-01", thin, Math.ceil(thin / 2)),
        ],
        "2026-07-24",
      ),
    ).toEqual([]);
  });

  test("reports an infinite lift when current never fails on that route", () => {
    const lifts = rankVersionCorrelatedErrors(
      [
        signature("GET /v1/thing", "2026-07-24", 10_000, 0),
        signature("GET /v1/thing", "2025-08-01", 1_000, 40),
      ],
      "2026-07-24",
    );

    expect(lifts).toHaveLength(1);
    expect(lifts[0]!.lift).toBe(Number.POSITIVE_INFINITY);
  });

  test("drops versions that fail no more than current, and bounds the list", () => {
    const rows = [
      signature("GET /v1/same", "2026-07-24", 10_000, 100),
      // Identical rate — not a finding.
      signature("GET /v1/same", "2025-08-01", 1_000, 10),
      // Better than current — definitely not a finding.
      signature("GET /v1/same", "2025-06-01", 1_000, 1),
    ];
    expect(rankVersionCorrelatedErrors(rows, "2026-07-24")).toEqual([]);

    const many = Array.from({ length: 12 }, (_, index) => [
      signature(`GET /v1/route-${index}`, "2026-07-24", 10_000, 10),
      signature(`GET /v1/route-${index}`, "2025-08-01", 1_000, 20 + index),
    ]).flat();
    expect(rankVersionCorrelatedErrors(many, "2026-07-24")).toHaveLength(5);
    expect(rankVersionCorrelatedErrors(many, "2026-07-24", 3)).toHaveLength(3);
  });

  test("has nothing to compare against without a current version", () => {
    expect(
      rankVersionCorrelatedErrors(
        [signature("GET /v1/thing", "2025-08-01", 1_000, 100)],
        null,
      ),
    ).toEqual([]);
  });
});

describe("overview query shapes", () => {
  test("count errors and requests from the same unsampled table", () => {
    const key = JSON.stringify(
      routeVersionErrorsQueryOptions({ projectId, days: 30 }).queryKey,
    );

    // Traces head-sample at 10%, so a numerator from otel_traces over a
    // denominator from otel_logs is off by roughly 10x. Both come from logs.
    expect(key).toContain("FROM otel_logs");
    expect(key).not.toContain("otel_traces");
    expect(key).toContain("countIf(");
    expect(key).toContain("http.response.status_code");
    expect(key).toContain(
      "PREWHERE Timestamp >= now() - INTERVAL {days: UInt16} DAY",
    );
    expect(key).toContain("AND EventName = 'versionless.request'");
  });

  test("bound every raw scan at the source", () => {
    const routeErrors = JSON.stringify(
      routeVersionErrorsQueryOptions({ projectId, days: 30 }).queryKey,
    );
    expect(routeErrors).toContain("HAVING requests >= {minRequests: UInt32}");
    expect(routeErrors).toContain("LIMIT {limit: UInt16}");

    const outreach = JSON.stringify(
      outreachQueryOptions({ projectId, days: 30 }).queryKey,
    );
    expect(outreach).toContain("LIMIT {limit: UInt16}");
    // Consumer cardinality is unbounded, so the distinct-count must be the
    // approximate, mergeable one.
    expect(outreach).toContain("uniq(");
    expect(outreach).not.toContain("uniqExact(");

    // Freshness scans two hours, never the retention window.
    const freshness = JSON.stringify(
      ingestFreshnessQueryOptions({ projectId }).queryKey,
    );
    expect(freshness).toContain("PREWHERE Timestamp >= now() - INTERVAL 2 HOUR");
    expect(freshness).toContain("AND EventName = 'versionless.request'");
  });

  test("names the version a consumer is on now, not its modal version", () => {
    const key = JSON.stringify(
      outreachQueryOptions({ projectId, days: 30 }).queryKey,
    );

    // The modal version would still name the old one the day after a consumer
    // migrates, which is exactly when an outreach email is wrong to send.
    expect(key).toContain(
      "LogAttributes['versionless.version'] AS requested_version",
    );
    expect(key).toContain("argMax(requested_version, Timestamp)");
  });
});

describe("ingest freshness grading", () => {
  const now = new Date("2026-07-26T12:00:00.000Z");

  test("treats recent telemetry as live", () => {
    expect(
      ingestState(
        { lastEventAt: "2026-07-26 11:56:00", lastHour: 900, priorHour: 880 },
        now,
      ),
    ).toEqual({ state: "live", minutesSince: 4 });
  });

  test("separates a quiet API from a broken exporter", () => {
    // Busy an hour ago, nothing since: that is a pipeline that stopped, not a
    // lull, and it is the case a flat green line would hide.
    expect(
      ingestState(
        { lastEventAt: "2026-07-26 11:00:00", lastHour: 0, priorHour: 400 },
        now,
      ),
    ).toMatchObject({ state: "stale", minutesSince: 60 });

    // Low traffic throughout — working correctly, just not busy.
    expect(
      ingestState(
        { lastEventAt: "2026-07-26 11:00:00", lastHour: 0, priorHour: 0 },
        now,
      ),
    ).toMatchObject({ state: "quiet", minutesSince: 60 });
  });

  test("calls anything older than two hours stale", () => {
    expect(
      ingestState(
        { lastEventAt: "2026-07-26 06:00:00", lastHour: 0, priorHour: 0 },
        now,
      ),
    ).toEqual({ state: "stale", minutesSince: 360 });
  });

  test("reports silence when nothing has ever arrived", () => {
    expect(
      ingestState({ lastEventAt: null, lastHour: 0, priorHour: 0 }, now),
    ).toEqual({ state: "silent", minutesSince: null });
    expect(
      ingestState({ lastEventAt: "not-a-date", lastHour: 0, priorHour: 0 }, now),
    ).toEqual({ state: "silent", minutesSince: null });
  });

  test("never reports negative age from clock skew between browser and server", () => {
    const skewed = ingestState(
      { lastEventAt: "2026-07-26 12:05:00", lastHour: 10, priorHour: 10 },
      now,
    );

    expect(skewed.minutesSince).toBe(0);
    expect(skewed.state).toBe("live");
  });
});
