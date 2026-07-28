import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { hexclaveClientApp } from "@/hexclave/client";

import {
  ROLLUP_TABLE,
  rollupDailyQueryOptions,
  trafficCurveQueryOptions,
  rollupTotalsQueryOptions,
  rollupVersionsQueryOptions,
  type RollupTotals,
} from "./rollup";

const projectId = "11111111-1111-4111-8111-111111111111";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

function stubRows(rows: unknown[]) {
  spyOn(hexclaveClientApp, "getAuthorizationHeader").mockResolvedValue(
    "Bearer test-token",
  );
  globalThis.fetch = mock(async () =>
    Response.json({ result: rows }),
  ) as unknown as typeof fetch;
}

async function run<T>(options: { queryKey: readonly unknown[] } & object, rows: unknown[]) {
  stubRows(rows);
  const observer = new QueryObserver(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    options as never,
  );
  const result = await observer.refetch();
  if (result.data === undefined) throw new Error("query returned no data");
  return result.data as T;
}

const ALL = [
  rollupTotalsQueryOptions({ projectId, days: 30 }),
  rollupDailyQueryOptions({ projectId, days: 30 }),
  rollupVersionsQueryOptions({ projectId, days: 30 }),
];

describe("rollup queries", () => {
  test("read the rollup, never raw log or trace rows", () => {
    for (const options of ALL) {
      const key = JSON.stringify(options.queryKey);
      expect(key).toContain(`FROM ${ROLLUP_TABLE}`);
      expect(key).not.toContain("otel_logs");
      expect(key).not.toContain("otel_traces");
      // Tenancy comes from the row policy, never from inlined SQL.
      expect(key).not.toContain("project_id =");
      expect(key).not.toContain(projectId.slice(0, 8) + "'");
    }
  });

  test("merge aggregate states rather than re-aggregating finals", () => {
    for (const options of ALL) {
      const key = JSON.stringify(options.queryKey);
      // A daily quantile cannot be re-quantiled, and daily distinct-counts
      // cannot be summed — both need their mergeable state.
      if (key.includes("latency")) {
        expect(key).toContain("quantilesTDigestMerge");
        expect(key).not.toContain("quantilesTDigest(");
      }
      if (key.includes("consumers")) {
        expect(key).toContain("uniqMerge(consumers)");
        expect(key).not.toContain("sum(consumers)");
      }
    }
  });

  test("never alias an aggregate to the name of a column it aggregates", () => {
    // ClickHouse resolves an identifier against the SELECT's own aliases before
    // the table's columns, so `sum(requests) AS requests` beside
    // `sum(depth_sum) / sum(requests)` expands the second reference to
    // `sum(sum(requests))` and the server rejects the whole query with
    // "Aggregate function sum(requests) AS requests is found inside another
    // aggregate function". The SQL reads correctly; only the server objects,
    // which is why this test asserts on the aliasing rule rather than on any
    // particular expression.
    const columns = [
      "requests", "errors", "consumers", "latency",
      "depth_sum", "depth_max", "negotiated", "sourced", "unpinned", "clamped",
    ];

    for (const options of ALL) {
      const sql = String(options.queryKey[3]);
      for (const column of columns) {
        const aliased = new RegExp(
          `\\b(sum|max|min|uniqMerge|quantilesTDigestMerge)\\([^)]*\\)\\s+AS\\s+${column}\\b`,
        );
        expect(sql).not.toMatch(aliased);
      }
    }
  });

  test("bound the per-version list so version count cannot unbound the scan", () => {
    const key = JSON.stringify(
      rollupVersionsQueryOptions({ projectId, days: 30 }).queryKey,
    );

    expect(key).toContain("LIMIT {limit: UInt16}");
  });

  test("uses hourly raw points for 24h and daily rollups for longer windows", () => {
    const hourly = JSON.stringify(
      trafficCurveQueryOptions({ projectId, days: 1 }).queryKey,
    );
    const daily = JSON.stringify(
      trafficCurveQueryOptions({ projectId, days: 7 }).queryKey,
    );

    expect(hourly).toContain("toStartOfHour(Timestamp)");
    expect(hourly).toContain("INTERVAL {hours: UInt16} HOUR");
    expect(hourly).toContain("FROM otel_logs");
    expect(hourly).toContain("WITH FILL");
    expect(hourly).toContain("STEP INTERVAL 1 HOUR");
    expect(hourly).not.toContain(ROLLUP_TABLE);
    expect(daily).toContain(`FROM ${ROLLUP_TABLE}`);
    expect(daily).toContain("GROUP BY day");
    expect(daily).not.toContain("toStartOfHour");
  });

  test("derives the error rate from one table's numerator and denominator", async () => {
    const totals = await run<RollupTotals>(
      rollupTotalsQueryOptions({ projectId, days: 30 }),
      [
        {
          requests: "20000",
          errors: "250",
          consumers: "84",
          p50: "11",
          p95: "60",
          p99: "180",
          avg_depth: "2.5",
          max_depth: "8",
          negotiated: "300",
          sourced: "16000",
          unpinned: "4000",
          clamped: "12",
        },
      ],
    );

    expect(totals.requests).toBe(20_000);
    expect(totals.errors).toBe(250);
    expect(totals.errorRate).toBeCloseTo(0.0125, 6);
    expect(totals.consumers).toBe(84);
    expect(totals.p95).toBe(60);
    expect(totals.avgDepth).toBe(2.5);
    expect(totals.negotiated).toBe(300);
    // `sourced` is carried separately from `requests` so the negotiation panel
    // can tell "no client sent a pin" from "we did not record where the version
    // came from" — the rollup predates that attribute.
    expect(totals.sourced).toBe(16_000);
    expect(totals.unpinned).toBe(4_000);
    expect(totals.clamped).toBe(12);
  });

  test("zeroes the negotiation columns on rollup days written before they existed", async () => {
    const totals = await run<RollupTotals>(
      rollupTotalsQueryOptions({ projectId, days: 30 }),
      [
        {
          requests: "20000",
          errors: "0",
          consumers: "84",
          p50: "11",
          p95: "60",
          p99: "180",
          avg_depth: "2.5",
          max_depth: "8",
          negotiated: "0",
        },
      ],
    );

    expect(totals.requests).toBe(20_000);
    expect(totals.sourced).toBe(0);
    expect(Number.isNaN(totals.sourced)).toBeFalse();
    expect(Number.isNaN(totals.unpinned)).toBeFalse();
    expect(Number.isNaN(totals.clamped)).toBeFalse();
  });

  test("returns zeroed totals rather than dividing by zero on an empty window", async () => {
    const totals = await run<RollupTotals>(
      rollupTotalsQueryOptions({ projectId, days: 30 }),
      [],
    );

    expect(totals.requests).toBe(0);
    expect(totals.errorRate).toBe(0);
    expect(Number.isNaN(totals.errorRate)).toBeFalse();
  });

  test("keeps a zero-traffic day at a zero rate, not NaN", async () => {
    const days = await run<Array<{ day: string; errorRate: number }>>(
      rollupDailyQueryOptions({ projectId, days: 30 }),
      [
        {
          day: "2026-07-24",
          requests: "0",
          errors: "0",
          consumers: "0",
          p95: "0",
          avg_depth: "0",
        },
        {
          day: "2026-07-25",
          requests: "400",
          errors: "20",
          consumers: "9",
          p95: "48",
          avg_depth: "1.5",
        },
      ],
    );

    expect(days[0]!.errorRate).toBe(0);
    expect(days[1]!.errorRate).toBeCloseTo(0.05, 6);
  });
});
