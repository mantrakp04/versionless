import { expect, test } from "bun:test";

import { pivotSeries } from "./query-chart";
import { createMdxComponents, MDX_COMPONENT_NAMES } from "./registry";
import type { QueryRunner } from "./query-runner";

const unusedQueryRunner: QueryRunner = async () => [];

test("exposes exactly the components the system prompt advertises", () => {
  const components = createMdxComponents("p_1", unusedQueryRunner);
  for (const name of MDX_COMPONENT_NAMES) {
    expect(components[name]).toBeDefined();
  }
  // Unknown capitalized component names fail closed. Intrinsic HTML elements
  // are instead contained by the opaque-origin iframe and its CSP.
  expect(components.QueryDashboard).toBeUndefined();
});

test("binds the project scope and query runner so MDX cannot choose either", () => {
  const components = createMdxComponents("p_authorized", unusedQueryRunner);
  const QueryTable = components.QueryTable as (props: {
    projectId?: string;
    select: string;
    from: string;
    columns: never[];
  }) => { props: { projectId: string; runQuery: QueryRunner } };

  const element = QueryTable({
    // A projectId written into the MDX is overridden by the bound one.
    projectId: "p_someone_else",
    select: "1",
    from: "otel_logs",
    columns: [],
  });
  expect(element.props.projectId).toBe("p_authorized");
  expect(element.props.runQuery).toBe(unusedQueryRunner);
});

test("pivots flat rows into one point per x value", () => {
  const { keys, data } = pivotSeries(
    [
      { day: "2026-07-01", version: "a", requests: 10 },
      { day: "2026-07-01", version: "b", requests: 4 },
      { day: "2026-07-02", version: "a", requests: 12 },
    ],
    { x: "day", y: "requests", series: "version", topN: 6 },
  );

  expect(keys).toEqual(["a", "b"]);
  // "b" was absent on the second day: zero-filled, not missing, so the line
  // does not break.
  expect(data).toEqual([
    { day: "2026-07-01", a: 10, b: 4 },
    { day: "2026-07-02", a: 12, b: 0 },
  ]);
});

test("caps the series count by total magnitude", () => {
  const rows = ["a", "b", "c", "d"].map((version, index) => ({
    day: "2026-07-01",
    version,
    requests: index,
  }));

  const { keys } = pivotSeries(rows, {
    x: "day",
    y: "requests",
    series: "version",
    topN: 2,
  });
  expect(keys).toEqual(["d", "c"]);
});

test("handles a single unsplit series and no rows", () => {
  expect(
    pivotSeries([{ day: "2026-07-01", requests: "9" }], {
      x: "day",
      y: "requests",
      topN: 6,
    }),
  ).toEqual({
    keys: ["requests"],
    // Counts arrive as strings from the driver for 64-bit columns.
    data: [{ day: "2026-07-01", requests: 9 }],
  });

  expect(pivotSeries([], { x: "day", y: "requests", topN: 6 })).toEqual({
    keys: [],
    data: [],
  });
});
