import { describe, expect, test } from "bun:test";
import { getQuery, QUERY_MAP, searchQueries } from "../src";

describe("query catalog", () => {
  test("provides named query strings generated from dashboard queries", () => {
    const query = getQuery("rollup-totals");

    expect(QUERY_MAP.size).toBeGreaterThan(20);
    expect(query).toEqual({
      name: "rollup-totals",
      description:
        "Headline request, error, consumer, latency, depth, and pinning totals.",
      query: expect.stringContaining("FROM versionless_rollup_daily"),
    });
  });

  test("searches names, descriptions, and SQL with every term required", () => {
    expect(searchQueries("consumer outreach").map((query) => query.name)).toEqual([
      "outreach-consumers",
    ]);
    expect(searchQueries("otel_traces error").length).toBeGreaterThan(0);
    expect(searchQueries("definitely-not-a-query")).toEqual([]);
  });
});
