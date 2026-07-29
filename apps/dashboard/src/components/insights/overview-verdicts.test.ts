import { expect, test } from "bun:test";

import type { AdoptionPoint, ProjectRelease } from "@/queries/insights";

import {
  currentTrafficVerdict,
  daysUntil,
  ingestVerdict,
  latencyVerdict,
  migrationDebtVerdict,
  negotiationShares,
  negotiationVerdict,
  nextSunset,
  releaseAdoptionVerdict,
  reliabilityVerdict,
  resolveCurrentVersion,
  sunsetVerdict,
  trendDirection,
  versionShareSeries,
} from "./overview-verdicts";

const TODAY = new Date("2026-07-26T09:30:00.000Z");

function release(
  version: string,
  after: string,
  message: string | null = null,
): ProjectRelease {
  return { version, after, message };
}

test("distinguishes a declared current version from a merely-observed one", () => {
  expect(resolveCurrentVersion("2026-07-24", ["2026-05-14"])).toEqual({
    version: "2026-07-24",
    source: "declared",
  });
  // No snapshot uploaded: the newest version seen in traffic is the best we
  // can do, and callers must be able to tell that apart from a declaration.
  expect(resolveCurrentVersion(null, ["2025-01-01", "2026-05-14"])).toEqual({
    version: "2026-05-14",
    source: "traffic",
  });
  expect(resolveCurrentVersion(null, [])).toEqual({
    version: null,
    source: "none",
  });
});

test("reads a trend from thirds so one quiet day is not a collapse", () => {
  expect(trendDirection([4, 4, 4, 1, 1, 1])).toBe("falling");
  expect(trendDirection([1, 1, 1, 4, 4, 4])).toBe("rising");
  expect(trendDirection([2, 2, 2, 2, 2, 2])).toBe("flat");
  // A single dip in the middle must not register as a direction.
  expect(trendDirection([2, 2, 0, 2, 2, 2])).toBe("flat");
  expect(trendDirection([0, 0, 0, 0])).toBe("flat");
  // Too short to say anything honestly.
  expect(trendDirection([5, 1, 1])).toBe("unknown");
});

test("counts whole days to a cutoff and goes negative once it passes", () => {
  expect(daysUntil("2026-08-01", TODAY)).toBe(6);
  expect(daysUntil("2026-07-26", TODAY)).toBe(0);
  expect(daysUntil("2026-07-20", TODAY)).toBe(-6);
  expect(daysUntil("not-a-date", TODAY)).toBeNull();
});

test("picks the soonest upcoming sunset, or the most recent overdue one", () => {
  expect(
    nextSunset(
      [release("2025-01-01", "2026-12-01"), release("2025-06-01", "2026-08-01")],
      TODAY,
    ),
  ).toMatchObject({ version: "2025-06-01", daysAway: 6 });

  // Every cutoff has passed. The most recent one is the urgent fact, not the
  // oldest — traffic still on it is already out of contract.
  expect(
    nextSunset(
      [release("2024-01-01", "2025-01-01"), release("2024-06-01", "2026-07-01")],
      TODAY,
    ),
  ).toMatchObject({ version: "2024-06-01", daysAway: -25 });

  expect(nextSunset([], TODAY)).toBeNull();
  expect(nextSunset([release("2025-01-01", "whenever")], TODAY)).toBeNull();
});

test("calls out a long tail when request share runs ahead of consumer share", () => {
  // One large customer migrated; the small callers did not. That divergence is
  // the finding, and a request-share-only read would have called it healthy.
  expect(
    currentTrafficVerdict({
      requests: 100_000,
      requestShare: 0.94,
      consumerShare: 0.3,
    }),
  ).toEqual({ verdict: "Long tail", tone: "negative" });

  expect(
    currentTrafficVerdict({
      requests: 100_000,
      requestShare: 0.97,
      consumerShare: 0.95,
    }),
  ).toEqual({ verdict: "Current", tone: "positive" });
  expect(
    currentTrafficVerdict({
      requests: 100,
      requestShare: 0.7,
      consumerShare: 0.7,
    }),
  ).toMatchObject({ verdict: "Mixed" });
  expect(
    currentTrafficVerdict({ requests: 100, requestShare: 0.2, consumerShare: 0.2 }),
  ).toMatchObject({ verdict: "Lagging" });
  expect(
    currentTrafficVerdict({ requests: 0, requestShare: 0, consumerShare: 0 }),
  ).toMatchObject({ verdict: "No traffic", tone: "muted" });
});

test("grades migration debt by where the depth curve is heading", () => {
  expect(
    migrationDebtVerdict({ avgDepth: 0, dailyDepth: [0, 0, 0, 0] }),
  ).toMatchObject({ verdict: "None", tone: "positive" });
  expect(
    migrationDebtVerdict({ avgDepth: 1.4, dailyDepth: [3, 3, 2, 1, 1, 1] }),
  ).toMatchObject({ verdict: "Retiring", tone: "positive" });
  expect(
    migrationDebtVerdict({ avgDepth: 1.4, dailyDepth: [1, 1, 2, 3, 3, 3] }),
  ).toMatchObject({ verdict: "Accumulating", tone: "negative" });
  expect(
    migrationDebtVerdict({ avgDepth: 1.4, dailyDepth: [2, 2, 2, 2] }),
  ).toMatchObject({ verdict: "Flat" });
  // Not enough days to claim a direction.
  expect(
    migrationDebtVerdict({ avgDepth: 1.4, dailyDepth: [2, 2] }),
  ).toMatchObject({ verdict: "Carried" });
});

test("separates an undeclared sunset from a scheduled one with no blockers", () => {
  expect(
    sunsetVerdict({ sunset: null, blockingConsumers: 0, declared: false }),
  ).toMatchObject({ verdict: "Not declared" });
  expect(
    sunsetVerdict({ sunset: null, blockingConsumers: 0, declared: true }),
  ).toMatchObject({ verdict: "None scheduled" });

  const soon = {
    version: "2025-01-01",
    after: "2026-08-01",
    daysAway: 6,
    message: null,
  };
  expect(
    sunsetVerdict({ sunset: soon, blockingConsumers: 0, declared: true }),
  ).toMatchObject({ verdict: "Clear", tone: "positive" });
  expect(
    sunsetVerdict({ sunset: soon, blockingConsumers: 3, declared: true }),
  ).toMatchObject({ verdict: "Blocked", tone: "negative" });
  expect(
    sunsetVerdict({
      sunset: { ...soon, daysAway: 120 },
      blockingConsumers: 3,
      declared: true,
    }),
  ).toMatchObject({ verdict: "In progress" });
  expect(
    sunsetVerdict({
      sunset: { ...soon, daysAway: -4 },
      blockingConsumers: 3,
      declared: true,
    }),
  ).toMatchObject({ verdict: "Overdue", tone: "negative" });
});

test("a version-correlated failure outranks a merely elevated error rate", () => {
  // 0.4% overall would read "Healthy", but a route failing 4x more on an old
  // version points at a down transform — the diagnosis only we can make.
  expect(
    reliabilityVerdict({ requests: 50_000, errorRate: 0.004, topLift: 4 }),
  ).toEqual({ verdict: "Version-linked", tone: "negative" });

  expect(
    reliabilityVerdict({ requests: 50_000, errorRate: 0, topLift: null }),
  ).toMatchObject({ verdict: "Clean" });
  expect(
    reliabilityVerdict({ requests: 50_000, errorRate: 0.004, topLift: null }),
  ).toMatchObject({ verdict: "Healthy" });
  expect(
    reliabilityVerdict({ requests: 50_000, errorRate: 0.02, topLift: null }),
  ).toMatchObject({ verdict: "Elevated" });
  expect(
    reliabilityVerdict({ requests: 50_000, errorRate: 0.08, topLift: null }),
  ).toMatchObject({ verdict: "Degraded" });
  expect(
    reliabilityVerdict({ requests: 0, errorRate: 0, topLift: null }),
  ).toMatchObject({ verdict: "No traffic", tone: "muted" });
});

test("says nothing about latency scaling when there is only one depth", () => {
  expect(
    latencyVerdict({ requests: 5_000, msPerTransform: null }),
  ).toEqual({ verdict: "Single depth", tone: "muted" });
  expect(latencyVerdict({ requests: 5_000, msPerTransform: 0.4 })).toMatchObject(
    { verdict: "Flat", tone: "positive" },
  );
  expect(latencyVerdict({ requests: 5_000, msPerTransform: 4 })).toMatchObject({
    verdict: "Climbing",
  });
  expect(latencyVerdict({ requests: 5_000, msPerTransform: 24 })).toMatchObject({
    verdict: "Scaling",
    tone: "negative",
  });
  expect(latencyVerdict({ requests: 0, msPerTransform: 24 })).toMatchObject({
    verdict: "No traffic",
  });
});

test("reports 'not recorded' rather than a confident zero for version source", () => {
  // Rollup days written before the source attribute shipped carry sourced = 0.
  // Dividing by `requests` there would claim "0% unpinned", which is a wrong
  // answer where "we did not measure it" is the true one.
  const missing = negotiationShares({
    requests: 90_000,
    sourced: 0,
    unpinned: 0,
    clamped: 0,
    negotiated: 0,
  });
  expect(missing.recorded).toBe(false);
  expect(missing.unpinnedShare).toBe(0);
  expect(negotiationVerdict(missing)).toEqual({
    verdict: "Not recorded",
    tone: "muted",
  });

  // Shares are over `sourced`, not `requests`: half the window predates the
  // attribute, and the recorded half is 50% unpinned — not 25%.
  const partial = negotiationShares({
    requests: 1_000,
    sourced: 400,
    unpinned: 200,
    clamped: 0,
    negotiated: 40,
  });
  expect(partial).toEqual({
    unpinnedShare: 0.5,
    clampedShare: 0,
    negotiatedShare: 0.1,
    recorded: true,
  });
  expect(negotiationVerdict(partial)).toMatchObject({ verdict: "Drifting" });
});

test("any clamped traffic outranks the unpinned share", () => {
  // A client pinned ahead of the deployed current means an SDK shipped before
  // the server it calls, or a rolled-back deploy. Rare but never benign.
  expect(
    negotiationVerdict(
      negotiationShares({
        requests: 1_000,
        sourced: 1_000,
        unpinned: 0,
        clamped: 1,
        negotiated: 1,
      }),
    ),
  ).toEqual({ verdict: "Skewed", tone: "negative" });

  expect(
    negotiationVerdict(
      negotiationShares({
        requests: 1_000,
        sourced: 1_000,
        unpinned: 20,
        clamped: 0,
        negotiated: 0,
      }),
    ),
  ).toMatchObject({ verdict: "Explicit", tone: "positive" });
  expect(
    negotiationVerdict(
      negotiationShares({
        requests: 1_000,
        sourced: 1_000,
        unpinned: 200,
        clamped: 0,
        negotiated: 0,
      }),
    ),
  ).toMatchObject({ verdict: "Mixed" });
});

test("tracks a version's share of traffic per bucket, not its raw volume", () => {
  const rows: AdoptionPoint[] = [
    { bucket: "2026-07-20", version: "2026-07-24", clients: 1, requests: 10 },
    { bucket: "2026-07-20", version: "2025-01-01", clients: 4, requests: 90 },
    { bucket: "2026-07-21", version: "2026-07-24", clients: 3, requests: 50 },
    { bucket: "2026-07-21", version: "2025-01-01", clients: 3, requests: 50 },
    { bucket: "2026-07-22", version: "2026-07-24", clients: 6, requests: 95 },
    { bucket: "2026-07-22", version: "2025-01-01", clients: 1, requests: 5 },
  ];
  const trend = versionShareSeries(rows, "2026-07-24");

  expect(trend.requests).toBe(155);
  expect(trend.series.map((point) => point.share)).toEqual([0.1, 0.5, 0.95]);
  expect(trend.priorShare).toBeCloseTo(0.1, 5);
  expect(trend.recentShare).toBeCloseTo(0.95, 5);
  expect(releaseAdoptionVerdict(trend)).toMatchObject({
    verdict: "Landed",
    tone: "positive",
  });
});

test("a brand-new release with no prior share counts as landing, not stalled", () => {
  const rows: AdoptionPoint[] = [
    { bucket: "2026-07-20", version: "2025-01-01", clients: 4, requests: 100 },
    { bucket: "2026-07-21", version: "2025-01-01", clients: 4, requests: 90 },
    { bucket: "2026-07-21", version: "2026-07-24", clients: 1, requests: 10 },
    { bucket: "2026-07-22", version: "2025-01-01", clients: 3, requests: 70 },
    { bucket: "2026-07-22", version: "2026-07-24", clients: 2, requests: 30 },
  ];
  expect(
    releaseAdoptionVerdict(versionShareSeries(rows, "2026-07-24")),
  ).toMatchObject({ verdict: "Landing", tone: "positive" });

  expect(
    releaseAdoptionVerdict(versionShareSeries(rows, "2099-01-01")),
  ).toMatchObject({ verdict: "Not called", tone: "muted" });
});

test("flags a receding release", () => {
  const rows: AdoptionPoint[] = [
    { bucket: "2026-07-20", version: "2026-07-24", clients: 5, requests: 80 },
    { bucket: "2026-07-20", version: "2025-01-01", clients: 1, requests: 20 },
    { bucket: "2026-07-21", version: "2026-07-24", clients: 3, requests: 50 },
    { bucket: "2026-07-21", version: "2025-01-01", clients: 3, requests: 50 },
    { bucket: "2026-07-22", version: "2026-07-24", clients: 1, requests: 20 },
    { bucket: "2026-07-22", version: "2025-01-01", clients: 5, requests: 80 },
  ];
  expect(
    releaseAdoptionVerdict(versionShareSeries(rows, "2026-07-24")),
  ).toMatchObject({ verdict: "Receding", tone: "negative" });
});

test("grades ingest health rather than treating silence as binary", () => {
  expect(ingestVerdict("live")).toEqual({ verdict: "Live", tone: "positive" });
  expect(ingestVerdict("quiet")).toEqual({ verdict: "Quiet", tone: "neutral" });
  expect(ingestVerdict("stale")).toEqual({ verdict: "Stale", tone: "negative" });
  expect(ingestVerdict("silent")).toEqual({
    verdict: "Silent",
    tone: "negative",
  });
});
