import { expect, test } from "bun:test";

import type { AdoptionPoint, VersionRouteAnalytics } from "@/queries/insights";

import {
  depthQualifier,
  routeVerdict,
  trafficVerdict,
  versionTrafficSeries,
} from "./version-runtime-analytics";

test("selects the runtime traffic for the viewed version", () => {
  const rows: AdoptionPoint[] = [
    {
      bucket: "2026-07-24 10:00:00",
      version: "2026-07-21",
      clients: 2,
      requests: 8,
    },
    {
      bucket: "2026-07-24 10:00:00",
      version: "2026-07-24",
      clients: 3,
      requests: 12,
    },
    {
      bucket: "2026-07-24 11:00:00",
      version: "2026-07-24",
      clients: 4,
      requests: 20,
    },
  ];

  expect(versionTrafficSeries(rows, "2026-07-24")).toEqual([
    { bucket: "2026-07-24 10:00:00", requests: 12 },
    { bucket: "2026-07-24 11:00:00", requests: 20 },
  ]);
});

test("grades traffic by the share of the project it still carries", () => {
  expect(trafficVerdict({ requests: 173_600, share: 62 })).toEqual({
    verdict: "Primary",
    tone: "positive",
  });
  expect(trafficVerdict({ requests: 173_600, share: 12 })).toEqual({
    verdict: "Active",
    tone: "neutral",
  });
  expect(trafficVerdict({ requests: 400, share: 2 })).toEqual({
    verdict: "Trailing",
    tone: "negative",
  });
});

test("calls out a version with no traffic left", () => {
  expect(trafficVerdict({ requests: 0, share: 0 })).toEqual({
    verdict: "Idle",
    tone: "muted",
  });
});

const route = (
  overrides: Partial<VersionRouteAnalytics>,
): VersionRouteAnalytics => ({
  route: "GET /v1/users",
  clients: 4,
  requests: 100,
  avgDepth: 1.4,
  p95Depth: 2,
  lastSeen: "2026-07-24 11:00:00",
  ...overrides,
});

test("separates load piled on one route from load spread across many", () => {
  expect(
    routeVerdict([route({ requests: 300 }), route({ route: "GET /v1/keys" })]),
  ).toEqual({ verdict: "Concentrated", tone: "neutral" });

  expect(
    routeVerdict([route({ requests: 100 }), route({ route: "GET /v1/keys" })]),
  ).toEqual({ verdict: "Spread", tone: "neutral" });
});

test("describes compatibility work in API changes rather than internal transforms", () => {
  expect(depthQualifier([route({ avgDepth: 0 })], 0)).toBe(
    "no API changes bridged",
  );
  expect(depthQualifier([route({})], 1.4)).toBe(
    "1.4 API changes bridged per request",
  );
});

test("reports an idle version with no active routes", () => {
  expect(routeVerdict([])).toEqual({ verdict: "No traffic", tone: "muted" });
  expect(depthQualifier([], 0)).toBeUndefined();
});
