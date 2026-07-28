import { describe, expect, test } from "bun:test";

import {
  createSeedContracts,
  createSeedScenario,
  SEED_ERROR_PROFILES,
  seedErrorProbability,
  seedErrorProfileFor,
} from "./seed-scenario";

const NOW = Date.parse("2026-07-24T20:00:00.000Z");

describe("scaled seed scenario", () => {
  test("builds a coherent multi-year API lifecycle at dashboard scale", () => {
    const scenario = createSeedScenario({ now: NOW });
    const eventCounts = new Map<string, number>();
    const clientSets = new Map<string, Set<string>>();
    const contractsByVersion = new Map(
      scenario.contracts.map((contract) => [contract.version, contract]),
    );
    const routeIdsByVersion = new Map(
      createSeedContracts(scenario.versions).map((contract) => [
        contract.version,
        new Set(contract.routes.map((route) => route.route)),
      ]),
    );
    let invalidRouteCount = 0;
    let failedEventCount = 0;
    let newestEvent = Number.NEGATIVE_INFINITY;
    let oldestEvent = Number.POSITIVE_INFINITY;

    for (const event of scenario.events) {
      eventCounts.set(event.version, (eventCounts.get(event.version) ?? 0) + 1);
      const clients = clientSets.get(event.version) ?? new Set<string>();
      clients.add(event.consumerKey ?? "anonymous");
      clientSets.set(event.version, clients);

      if (!routeIdsByVersion.get(event.version)?.has(event.route)) {
        invalidRouteCount += 1;
      }
      if (event.status >= 400) {
        failedEventCount += 1;
        expect(event.errorBody?.code).toBeTruthy();
        expect(event.errorBody?.message).toBeTruthy();
      } else {
        expect(event.errorBody).toBeUndefined();
      }
      newestEvent = Math.max(newestEvent, event.ts);
      oldestEvent = Math.min(oldestEvent, event.ts);
    }

    expect(scenario.versions.length).toBeGreaterThanOrEqual(50);
    expect(scenario.contracts.length).toBeLessThan(scenario.versions.length);
    expect(scenario.contracts.length).toBeGreaterThan(
      scenario.versions.length - 8,
    );
    expect(new Set(scenario.versions.map((plan) => plan.version)).size).toBe(
      scenario.versions.length,
    );
    expect(scenario.versions.map((plan) => plan.version)).toEqual(
      expect.arrayContaining([
        "2025-01-01",
        "2025-06-01",
        "2026-05-14",
        "2026-07-21",
      ]),
    );
    expect(scenario.events.length).toBeGreaterThan(150_000);
    expect(invalidRouteCount).toBe(0);
    expect(failedEventCount).toBeGreaterThan(0);
    expect(newestEvent).toBeLessThanOrEqual(NOW);
    expect(oldestEvent).toBeGreaterThan(NOW - 31 * 24 * 60 * 60 * 1000);

    for (const plan of scenario.versions) {
      const contract = contractsByVersion.get(plan.version);
      if (contract) {
        expect(Object.keys(contract.snapshot.endpoints ?? {})).toHaveLength(
          plan.endpointCount,
        );
      }
      expect(plan.endpointCount).toBeGreaterThanOrEqual(100);
      expect(eventCounts.get(plan.version)).toBe(plan.requestTarget);
      expect(plan.requestTarget).toBeGreaterThanOrEqual(2_000);
      expect(clientSets.get(plan.version)?.size).toBe(plan.clientCount);
    }

    const missingContractVersions = scenario.versions.filter(
      (plan) => !contractsByVersion.has(plan.version),
    );
    expect(missingContractVersions.length).toBeGreaterThanOrEqual(3);
    expect(
      missingContractVersions.every(
        (plan) => (eventCounts.get(plan.version) ?? 0) > 0,
      ),
    ).toBeTrue();

    const latest = scenario.versions.at(-1)!;
    const medianLongTail = scenario.versions.find(
      (plan) => plan.popularity === "long-tail",
    )!;
    expect(latest.popularity).toBe("launch");
    expect(latest.version).toBe("2026-07-21");
    expect(latest.requestTarget).toBeGreaterThan(
      medianLongTail.requestTarget * 5,
    );

    for (const profile of SEED_ERROR_PROFILES) {
      const matching = scenario.events.filter(
        (event) => seedErrorProfileFor(event) === profile,
      );
      expect(matching).toHaveLength(profile.occurrenceTarget);
      expect(new Set(matching.map((event) => event.latencyMs)).size).toBeGreaterThan(
        20,
      );
      expect(
        matching.some((event) => event.latencyMs >= profile.latencyMs.spike),
      ).toBeTrue();
    }
  });

  test("spreads error rates across signatures instead of one flat rate", () => {
    const scenario = createSeedScenario({ now: NOW });
    const bySignature = new Map<string, { requests: number; errors: number }>();
    for (const event of scenario.events) {
      const key = `${event.version} ${event.route}`;
      const counts = bySignature.get(key) ?? { requests: 0, errors: 0 };
      counts.requests += 1;
      if (event.status >= 400) counts.errors += 1;
      bySignature.set(key, counts);
    }

    const sampled = [...bySignature.values()].filter(
      (counts) => counts.requests >= 50,
    );
    const rates = sampled
      .map((counts) => counts.errors / counts.requests)
      .toSorted((left, right) => left - right);
    const quantile = (fraction: number) =>
      rates[Math.floor(fraction * (rates.length - 1))]!;
    const mean = rates.reduce((total, rate) => total + rate, 0) / rates.length;

    expect(rates.length).toBeGreaterThan(200);
    // Most signatures are healthy; a thin tail is genuinely broken. A flat
    // per-request rate would put every signature within noise of the mean.
    expect(quantile(0.5)).toBeLessThan(0.01);
    expect(quantile(0.99)).toBeGreaterThan(mean * 3);
    expect(rates.at(-1)!).toBeGreaterThan(0.4);

    // Overdispersion, stated as such: the spread of observed rates must exceed
    // what a single shared probability could produce (binomial variance
    // p(1-p)/n averaged over the signatures).
    const observedVariance =
      rates.reduce((total, rate) => total + (rate - mean) ** 2, 0) /
      rates.length;
    const binomialVariance =
      sampled.reduce(
        (total, counts) =>
          total + (mean * (1 - mean)) / Math.max(1, counts.requests),
        0,
      ) / sampled.length;
    expect(observedVariance).toBeGreaterThan(binomialVariance * 3);
  });

  test("fingerprints consumer keys exactly as the SDK does", () => {
    const scenario = createSeedScenario({ now: NOW });
    const keys = new Set(
      scenario.events.map((event) => event.consumerKey ?? "anonymous"),
    );

    for (const key of keys) expect(key).toMatch(/^c_[0-9a-f]{12}$/);
    // Opaque keys must still separate callers, or the outreach list is useless.
    expect(keys.size).toBeGreaterThan(50);
  });

  test("keeps a signature's health stable across reseeds", () => {
    // Real endpoints don't reshuffle their reliability every run, and the
    // dashboard's version-vs-version comparison is meaningless if they do.
    const first = seedErrorProbability("2025-08-01", "GET /v1/invoices/:id");
    const second = seedErrorProbability("2025-08-01", "GET /v1/invoices/:id");
    const other = seedErrorProbability("2025-08-01", "GET /v1/refunds");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1);
  });

  test("seeds a retirement schedule that stays current as the clock moves", () => {
    const scenario = createSeedScenario({ now: NOW });
    const versions = scenario.versions.map((plan) => plan.version);
    const day = (offset: number) =>
      new Date(NOW + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    expect(scenario.sunsets.length).toBeGreaterThan(0);
    for (const sunset of scenario.sunsets) {
      // A sunset for a version nobody released would never render.
      expect(versions).toContain(sunset.version);
      expect(sunset.after).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // Anchored to `now`, so the preview always shows one overdue cohort and one
    // closing soon rather than degenerating into all-ancient-history over time.
    const dates = scenario.sunsets.map((sunset) => sunset.after);
    expect(dates.some((after) => after < day(0))).toBeTrue();
    expect(
      dates.some((after) => after > day(0) && after < day(90)),
    ).toBeTrue();

    // Older cohorts retire first — a schedule that retired the newest version
    // before an older one would contradict core's "sunset X covers <= X" rule.
    const ordered = scenario.sunsets.toSorted((left, right) =>
      left.version.localeCompare(right.version),
    );
    expect(ordered).toEqual(scenario.sunsets);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]!.after > ordered[index - 1]!.after).toBeTrue();
    }
  });

  test("fails more often as the transform chain deepens", () => {
    const scenario = createSeedScenario({ now: NOW });
    const byDepth = new Map<number, { requests: number; errors: number }>();
    for (const event of scenario.events) {
      // Heavy-tail profiles are pinned to an exact occurrence count, so they
      // are an overlay on the model rather than a draw from it.
      if (seedErrorProfileFor(event)) continue;
      const counts = byDepth.get(event.transformCount) ?? {
        requests: 0,
        errors: 0,
      };
      counts.requests += 1;
      if (event.status >= 400) counts.errors += 1;
      byDepth.set(event.transformCount, counts);
    }

    const shallow = byDepth.get(0)!;
    const deep = byDepth.get(7)!;
    expect(shallow.requests).toBeGreaterThan(1_000);
    expect(deep.requests).toBeGreaterThan(1_000);
    // Each hop is another place a payload can fail the next version's shape,
    // so the deepest chains must fail measurably more than the undrifted ones.
    expect(deep.errors / deep.requests).toBeGreaterThan(
      (shallow.errors / shallow.requests) * 2,
    );
  });

  test("records where every request's version came from", () => {
    const scenario = createSeedScenario({ now: NOW });
    const bySource = new Map<string, number>();
    for (const event of scenario.events) {
      // Without this the overview's negotiation panel reads "not recorded" on
      // dev, which is the one state seeded data must never be able to show.
      expect(event.versionSource).toBeDefined();
      bySource.set(
        event.versionSource!,
        (bySource.get(event.versionSource!) ?? 0) + 1,
      );
    }

    const total = scenario.events.length;
    expect(bySource.get("header")! / total).toBeGreaterThan(0.4);
    // An unpinned share is the risk headline the panel exists to show, so the
    // seed has to carry a meaningful one rather than a rounding error.
    expect(bySource.get("default")! / total).toBeGreaterThan(0.1);
    expect(bySource.get("apiKey")).toBeGreaterThan(0);
    expect(bySource.get("query")).toBeGreaterThan(0);
  });

  test("keeps a consumer's pinning style stable, since it is an integration property", () => {
    const scenario = createSeedScenario({ now: NOW });
    const sourcesByConsumer = new Map<string, Set<string>>();
    for (const event of scenario.events) {
      // Clamped requests deliberately override the source, so exclude them.
      if (event.clamped) continue;
      const key = event.consumerKey ?? "anonymous";
      const sources = sourcesByConsumer.get(key) ?? new Set<string>();
      sources.add(event.versionSource!);
      sourcesByConsumer.set(key, sources);
    }

    // A client that hardcodes a version header does so on every call. Rolling
    // per-request would smear every consumer to the population mean.
    for (const sources of sourcesByConsumer.values()) {
      expect(sources.size).toBe(1);
    }
  });

  test("seeds a thin slice of clamped, rollback-skewed traffic", () => {
    const scenario = createSeedScenario({ now: NOW });
    const clamped = scenario.events.filter((event) => event.clamped);

    // Rare but present: an SDK pinned ahead of the server it calls. The panel
    // flags any of it, so zero would leave that path unexercised on dev.
    expect(clamped.length).toBeGreaterThan(0);
    expect(clamped.length / scenario.events.length).toBeLessThan(0.02);
    for (const event of clamped) {
      // The exchange only records a requested version when it differs from the
      // one served — which for a clamped request is the newer one asked for.
      expect(event.requestedVersion).toBeDefined();
      expect(event.requestedVersion! > event.version).toBeTrue();
    }
  });
});
