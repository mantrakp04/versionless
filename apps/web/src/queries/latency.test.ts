import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { hexclaveClientApp } from "@/hexclave/client";

import {
  latencyOverviewQueryOptions,
  slowestRoutesQueryOptions,
  type LatencyOverview,
} from "./latency";

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

async function runOverview(rows: unknown[]): Promise<LatencyOverview> {
  stubRows(rows);
  const observer = new QueryObserver(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    latencyOverviewQueryOptions({ projectId, days: 7 }),
  );
  const result = await observer.refetch();
  if (!result.data) throw new Error("query returned no data");
  return result.data;
}

const depthRow = (
  depth: number,
  p95: number,
  requests: number,
): Record<string, string> => ({
  row_kind: "depth",
  depth: String(depth),
  p50: String(p95 * 0.5),
  p95: String(p95),
  p99: String(p95 * 1.4),
  requests: String(requests),
});

describe("latency queries", () => {
  test("aggregate from the unsampled request log, not from traces", () => {
    const overview = latencyOverviewQueryOptions({ projectId, days: 7 });
    const routes = slowestRoutesQueryOptions({ projectId, days: 7 });

    for (const options of [overview, routes]) {
      const key = JSON.stringify(options.queryKey);
      // Traces head-sample at 10%; a latency distribution taken from them is a
      // distribution of a tenth of the traffic.
      expect(key).toContain("FROM otel_logs");
      expect(key).not.toContain("otel_traces");
      expect(key).toContain("EventName = 'versionless.request'");
      // Mergeable, memory-bounded quantiles — plain quantile() is neither.
      expect(key).toContain("quantilesTDigest(0.5, 0.95, 0.99)");
      expect(key).toContain("versionless.latency_ms");
      // Tenancy is enforced by row policies, never inlined into the SQL.
      expect(key).not.toContain("versionless.project.id");
    }

    // The slowest-route list must stay bounded regardless of route cardinality.
    expect(JSON.stringify(routes.queryKey)).toContain("LIMIT {limit: UInt16}");
  });

  test("splits overall totals from the per-depth breakdown", async () => {
    const data = await runOverview([
      {
        row_kind: "overall",
        depth: "0",
        p50: "12",
        p95: "48",
        p99: "96",
        requests: "1000",
      },
      depthRow(0, 20, 600),
      depthRow(1, 40, 400),
    ]);

    expect(data.overall).toEqual({
      p50: 12,
      p95: 48,
      p99: 96,
      requests: 1000,
    });
    expect(data.byDepth.map((row) => row.depth)).toEqual([0, 1]);
    expect(data.byDepth[0]?.requests).toBe(600);
  });

  test("fits the per-transform latency cost across depths", async () => {
    // p95 rises a clean 15ms per transform.
    const data = await runOverview([
      depthRow(0, 20, 500),
      depthRow(1, 35, 500),
      depthRow(2, 50, 500),
      depthRow(3, 65, 500),
    ]);

    expect(data.msPerTransform).toBeCloseTo(15, 6);
  });

  test("ignores depths with too little traffic to fit", async () => {
    // A single outlier request at depth 9 must not define the slope.
    const data = await runOverview([
      depthRow(0, 20, 500),
      depthRow(1, 30, 500),
      depthRow(9, 5_000, 3),
    ]);

    expect(data.msPerTransform).toBeCloseTo(10, 6);
  });

  test("reports no slope when depth never varies", async () => {
    const data = await runOverview([depthRow(2, 40, 900)]);

    expect(data.msPerTransform).toBeNull();
  });

  test("returns zeroed totals rather than throwing on an empty window", async () => {
    const data = await runOverview([]);

    expect(data.overall.requests).toBe(0);
    expect(data.byDepth).toEqual([]);
    expect(data.msPerTransform).toBeNull();
  });
});
