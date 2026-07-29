import { describe, expect, test } from "bun:test";

import {
  adoptionQueryOptions,
  sunsetBlockersQueryOptions,
  transformDepthQueryOptions,
  versionAggregationQueryOptions,
  versionRouteAnalyticsQueryOptions,
} from "./insights";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("insights query shapes", () => {
  test("uses rollups for complete adoption days and raw rows only at window edges", () => {
    const daily = JSON.stringify(adoptionQueryOptions(projectId, 30).queryKey);
    const hourly = JSON.stringify(adoptionQueryOptions(projectId, 1).queryKey);

    expect(daily).toContain("FROM versionless_rollup_daily");
    expect(daily).toContain("uniqMerge(consumer_state)");
    expect(daily).toContain("UNION ALL");
    expect(daily).toContain("FROM otel_logs");
    expect(daily).toContain("day < today()");
    expect(daily).toContain("Timestamp >= toStartOfDay(now())");
    expect(daily).toContain("sum(requests)");

    expect(hourly).toContain("FROM otel_logs");
    expect(hourly).toContain("toStartOfHour(Timestamp)");
    expect(hourly).not.toContain("versionless_rollup_daily");
  });

  test("filters raw scans before reading map attributes", () => {
    const rawQueries = [
      versionAggregationQueryOptions(projectId, 30),
      adoptionQueryOptions(projectId, 1),
      sunsetBlockersQueryOptions({
        projectId,
        version: "2026-07-21",
        sort: "requests",
        direction: "desc",
      }),
      transformDepthQueryOptions({
        projectId,
        days: 30,
        sort: "requests",
        direction: "desc",
      }),
      versionRouteAnalyticsQueryOptions({
        projectId,
        version: "2026-07-21",
        days: 30,
      }),
    ];

    for (const options of rawQueries) {
      const sql = String(options.queryKey[3]);
      const prewhere = sql.slice(sql.indexOf("PREWHERE"), sql.indexOf("GROUP BY"));
      expect(prewhere).toContain("Timestamp >=");
      expect(prewhere).toContain("EventName = 'versionless.request'");
    }
  });

  test("uses bounded-memory depth quantiles for version route analytics", () => {
    const sql = JSON.stringify(
      versionRouteAnalyticsQueryOptions({
        projectId,
        version: "2026-07-21",
        days: 30,
      }).queryKey,
    );

    expect(sql).toContain("quantileTDigest(0.95)(depth)");
    expect(sql).not.toContain("quantile(0.95)");
  });
});
