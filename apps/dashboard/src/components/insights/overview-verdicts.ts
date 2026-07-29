import type { AdoptionPoint, ProjectRelease } from "@/queries/insights";
import type { IngestState } from "@/queries/overview";

import type { StatTone } from "./report-section";

/**
 * Every collapsed overview row states a one-word verdict. Those words are the
 * page — a reader who expands nothing should still leave knowing whether to
 * act. Keeping the rules here, as pure functions over already-fetched numbers,
 * means the thresholds are reviewable and testable without a DOM.
 */
export interface SectionVerdict {
  verdict: string;
  tone: StatTone;
}

export const LOADING_VERDICT: SectionVerdict = {
  verdict: "Loading",
  tone: "muted",
};

// ---------------------------------------------------------------------------
// Shared helpers

/**
 * The version this API considers current. A declared version comes from an
 * uploaded `versionless snapshot` and is authoritative; without one we can only
 * report the newest version clients *ask for*, which is not the same claim —
 * hence the tag, so callers must say which one they are showing.
 */
export function resolveCurrentVersion(
  declared: string | null,
  trafficVersions: readonly string[],
): { version: string | null; source: "declared" | "traffic" | "none" } {
  if (declared) return { version: declared, source: "declared" };
  const newest = [...trafficVersions].sort().at(-1);
  return newest
    ? { version: newest, source: "traffic" }
    : { version: null, source: "none" };
}

/**
 * Trend of a short daily series, comparing the leading third against the
 * trailing third. A first-vs-last comparison would call a single quiet day a
 * collapse; thirds smooth that without needing a real regression.
 */
export function trendDirection(
  values: readonly number[],
  threshold = 0.05,
): "falling" | "flat" | "rising" | "unknown" {
  if (values.length < 4) return "unknown";
  const span = Math.max(1, Math.floor(values.length / 3));
  const mean = (slice: readonly number[]) =>
    slice.reduce((total, value) => total + value, 0) / Math.max(slice.length, 1);
  const start = mean(values.slice(0, span));
  const end = mean(values.slice(-span));
  if (start === 0 && end === 0) return "flat";
  const change = (end - start) / Math.max(Math.abs(start), 1e-9);
  if (change > threshold) return "rising";
  if (change < -threshold) return "falling";
  return "flat";
}

/** Whole days from `today` to a `YYYY-MM-DD` cutoff; negative once it passes. */
export function daysUntil(after: string, today: Date): number | null {
  const cutoff = new Date(`${after}T00:00:00Z`);
  if (Number.isNaN(cutoff.getTime())) return null;
  const start = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return Math.round((cutoff.getTime() - start) / 86_400_000);
}

export interface NextSunset {
  version: string;
  after: string;
  daysAway: number;
  message: string | null;
}

/**
 * The sunset a user should be worrying about: the soonest one still ahead, or
 * — when every declared cutoff has already passed — the most recent one, since
 * an overdue sunset with traffic still on it is the more urgent fact.
 */
export function nextSunset(
  sunsets: readonly ProjectRelease[],
  today: Date,
): NextSunset | null {
  const dated = sunsets.flatMap((sunset) => {
    const daysAway = daysUntil(sunset.after, today);
    return daysAway === null ? [] : [{ ...sunset, daysAway }];
  });
  if (dated.length === 0) return null;

  const upcoming = dated
    .filter((sunset) => sunset.daysAway >= 0)
    .toSorted((left, right) => left.daysAway - right.daysAway);
  const overdue = dated.toSorted((left, right) => right.daysAway - left.daysAway);
  const chosen = upcoming[0] ?? overdue[0]!;
  return {
    version: chosen.version,
    after: chosen.after,
    daysAway: chosen.daysAway,
    message: chosen.message,
  };
}

// ---------------------------------------------------------------------------
// 01 — Traffic on current

/**
 * Request share and consumer share are graded together because they diverge,
 * and the divergence *is* the finding: 95% of requests but 40% of consumers
 * means one large customer migrated and a long tail has not.
 */
export function currentTrafficVerdict(input: {
  requests: number;
  requestShare: number;
  consumerShare: number;
}): SectionVerdict {
  if (input.requests === 0) return { verdict: "No traffic", tone: "muted" };
  if (input.requestShare >= 0.95 && input.consumerShare >= 0.9) {
    return { verdict: "Current", tone: "positive" };
  }
  if (input.requestShare >= 0.9 && input.consumerShare < 0.6) {
    return { verdict: "Long tail", tone: "negative" };
  }
  if (input.requestShare >= 0.6) return { verdict: "Mixed", tone: "neutral" };
  return { verdict: "Lagging", tone: "negative" };
}

// ---------------------------------------------------------------------------
// 02 — Migration debt

/**
 * Transform depth is a literal debt meter: the number of reversible transforms
 * a request had to run. After a migration campaign it should fall. Flat or
 * rising means versioning is accumulating rather than retiring.
 */
export function migrationDebtVerdict(input: {
  avgDepth: number;
  dailyDepth: readonly number[];
}): SectionVerdict {
  if (input.avgDepth < 0.05) return { verdict: "None", tone: "positive" };
  switch (trendDirection(input.dailyDepth)) {
    case "falling":
      return { verdict: "Retiring", tone: "positive" };
    case "rising":
      return { verdict: "Accumulating", tone: "negative" };
    case "flat":
      return { verdict: "Flat", tone: "neutral" };
    default:
      return { verdict: "Carried", tone: "neutral" };
  }
}

// ---------------------------------------------------------------------------
// 03 — Sunset readiness

export function sunsetVerdict(input: {
  sunset: NextSunset | null;
  blockingConsumers: number;
  declared: boolean;
}): SectionVerdict {
  if (!input.sunset) {
    return input.declared
      ? { verdict: "None scheduled", tone: "muted" }
      : { verdict: "Not declared", tone: "muted" };
  }
  if (input.blockingConsumers === 0) return { verdict: "Clear", tone: "positive" };
  if (input.sunset.daysAway < 0) return { verdict: "Overdue", tone: "negative" };
  if (input.sunset.daysAway <= 30) return { verdict: "Blocked", tone: "negative" };
  return { verdict: "In progress", tone: "neutral" };
}

// ---------------------------------------------------------------------------
// 04 — Reliability

/**
 * A version-correlated failure outranks a merely elevated rate. A route that
 * fails far more on an old version than on current points at a `down`
 * transform — a diagnosis no generic APM can make, because only versionless
 * knows a transform chain ran at all.
 */
export function reliabilityVerdict(input: {
  requests: number;
  errorRate: number;
  topLift: number | null;
}): SectionVerdict {
  if (input.requests === 0) return { verdict: "No traffic", tone: "muted" };
  if (input.topLift !== null && input.topLift >= 2) {
    return { verdict: "Version-linked", tone: "negative" };
  }
  if (input.errorRate === 0) return { verdict: "Clean", tone: "positive" };
  if (input.errorRate >= 0.05) return { verdict: "Degraded", tone: "negative" };
  if (input.errorRate >= 0.01) return { verdict: "Elevated", tone: "negative" };
  return { verdict: "Healthy", tone: "positive" };
}

// ---------------------------------------------------------------------------
// 05 — Latency

/** Milliseconds of p95 per transform, above which versioning is a cost centre. */
const LATENCY_SCALING_MS = 10;
const LATENCY_CLIMBING_MS = 3;

export function latencyVerdict(input: {
  requests: number;
  msPerTransform: number | null;
}): SectionVerdict {
  if (input.requests === 0) return { verdict: "No traffic", tone: "muted" };
  if (input.msPerTransform === null) {
    return { verdict: "Single depth", tone: "muted" };
  }
  if (input.msPerTransform >= LATENCY_SCALING_MS) {
    return { verdict: "Scaling", tone: "negative" };
  }
  if (input.msPerTransform >= LATENCY_CLIMBING_MS) {
    return { verdict: "Climbing", tone: "neutral" };
  }
  return { verdict: "Flat", tone: "positive" };
}

// ---------------------------------------------------------------------------
// 06 — Version negotiation

export interface NegotiationShares {
  /** Share of *recorded* requests that sent no pin at all. */
  unpinnedShare: number;
  clampedShare: number;
  negotiatedShare: number;
  /** False when no request in the window recorded a version source. */
  recorded: boolean;
}

/**
 * Shares are taken over `sourced`, not `requests`. Rollup days written before
 * the source attribute shipped carry `sourced = 0`, and dividing by `requests`
 * there would render "0% unpinned" — a confident wrong answer where "not
 * recorded" is the true one.
 */
export function negotiationShares(totals: {
  requests: number;
  sourced: number;
  unpinned: number;
  clamped: number;
  negotiated: number;
}): NegotiationShares {
  if (totals.sourced === 0) {
    return {
      unpinnedShare: 0,
      clampedShare: 0,
      negotiatedShare: 0,
      recorded: false,
    };
  }
  return {
    unpinnedShare: totals.unpinned / totals.sourced,
    clampedShare: totals.clamped / totals.sourced,
    negotiatedShare: totals.negotiated / totals.sourced,
    recorded: true,
  };
}

export function negotiationVerdict(shares: NegotiationShares): SectionVerdict {
  if (!shares.recorded) return { verdict: "Not recorded", tone: "muted" };
  // A clamped client is pinned ahead of the deployed `current` — an SDK that
  // shipped before the server it is talking to. That is a rollback skew and
  // outranks the unpinned share, however small it is.
  if (shares.clampedShare > 0) return { verdict: "Skewed", tone: "negative" };
  if (shares.unpinnedShare >= 0.4) return { verdict: "Drifting", tone: "negative" };
  if (shares.unpinnedShare >= 0.1) return { verdict: "Mixed", tone: "neutral" };
  return { verdict: "Explicit", tone: "positive" };
}

// ---------------------------------------------------------------------------
// 07 — Outreach

export function outreachVerdict(input: {
  consumers: number;
  offCurrent: number;
}): SectionVerdict {
  if (input.consumers === 0) return { verdict: "No consumers", tone: "muted" };
  if (input.offCurrent <= 0) return { verdict: "All current", tone: "positive" };
  return { verdict: "Outreach", tone: "neutral" };
}

// ---------------------------------------------------------------------------
// 08 — Release adoption

export interface AdoptionTrend {
  /** Share of requests on the version across the trailing third of the window. */
  recentShare: number;
  /** The same share across the leading third, for a landed-or-stalled read. */
  priorShare: number;
  requests: number;
  series: Array<{ bucket: string; share: number }>;
}

/** Per-bucket share of total traffic held by one version. */
export function versionShareSeries(
  rows: readonly AdoptionPoint[],
  version: string,
): AdoptionTrend {
  const totals = new Map<string, { total: number; version: number }>();
  for (const row of rows) {
    const entry = totals.get(row.bucket) ?? { total: 0, version: 0 };
    entry.total += row.requests;
    if (row.version === version) entry.version += row.requests;
    totals.set(row.bucket, entry);
  }

  const series = [...totals.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([bucket, entry]) => ({
      bucket,
      share: entry.total > 0 ? entry.version / entry.total : 0,
      requests: entry.version,
    }));

  const span = Math.max(1, Math.floor(series.length / 3));
  const mean = (slice: typeof series) =>
    slice.reduce((total, point) => total + point.share, 0) /
    Math.max(slice.length, 1);

  return {
    recentShare: series.length > 0 ? mean(series.slice(-span)) : 0,
    priorShare: series.length > 0 ? mean(series.slice(0, span)) : 0,
    requests: series.reduce((total, point) => total + point.requests, 0),
    series: series.map(({ bucket, share }) => ({ bucket, share })),
  };
}

export function releaseAdoptionVerdict(trend: AdoptionTrend): SectionVerdict {
  if (trend.requests === 0) return { verdict: "Not called", tone: "muted" };
  if (trend.recentShare >= 0.9) return { verdict: "Landed", tone: "positive" };
  // A brand-new release has no leading third to grow from, so treat any
  // meaningful trailing share as landing rather than as a stall.
  if (trend.recentShare > trend.priorShare * 1.1 || trend.priorShare === 0) {
    return { verdict: "Landing", tone: "positive" };
  }
  if (trend.recentShare < trend.priorShare * 0.9) {
    return { verdict: "Receding", tone: "negative" };
  }
  return { verdict: "Stalled", tone: "negative" };
}

// ---------------------------------------------------------------------------
// 09 — Ingest health

export function ingestVerdict(state: IngestState): SectionVerdict {
  switch (state) {
    case "live":
      return { verdict: "Live", tone: "positive" };
    case "quiet":
      return { verdict: "Quiet", tone: "neutral" };
    case "stale":
      return { verdict: "Stale", tone: "negative" };
    default:
      return { verdict: "Silent", tone: "negative" };
  }
}
