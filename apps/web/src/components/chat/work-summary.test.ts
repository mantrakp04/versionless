import { expect, test } from "bun:test";

import { formatDuration, toWorkStep, workSummary } from "./work-summary";

test("reads a tool part through its whole lifecycle", () => {
  expect(
    toWorkStep({ type: "tool-clickhouse_query", state: "input-streaming" }),
  ).toEqual({ toolName: "clickhouse_query", state: "running", sql: undefined });

  expect(
    toWorkStep({
      type: "tool-clickhouse_query",
      state: "input-available",
      input: { sql: "SELECT 1" },
    }),
  ).toEqual({
    toolName: "clickhouse_query",
    state: "running",
    sql: "SELECT 1",
  });

  expect(
    toWorkStep({
      type: "tool-postgres_query",
      state: "output-available",
      input: { sql: "SELECT id FROM projects" },
      output: { ok: true, rows: [{ id: 1 }], truncated: false },
    }),
  ).toEqual({
    toolName: "postgres_query",
    state: "done",
    sql: "SELECT id FROM projects",
    detail: "1 row",
  });
});

test("counts a tool that returned ok:false as failed even though it did not throw", () => {
  expect(
    toWorkStep({
      type: "tool-clickhouse_query",
      state: "output-available",
      input: { sql: "SELECT bad" },
      output: { ok: false, error: "Error during execution of this query." },
    }),
  ).toEqual({
    toolName: "clickhouse_query",
    state: "failed",
    sql: "SELECT bad",
    detail: "Error during execution of this query.",
  });

  expect(
    toWorkStep({
      type: "tool-clickhouse_query",
      state: "output-error",
      errorText: "timed out",
    }),
  ).toEqual({
    toolName: "clickhouse_query",
    state: "failed",
    sql: undefined,
    detail: "timed out",
  });
});

test("reports a capped result and pluralizes the row count", () => {
  expect(
    toWorkStep({
      type: "tool-clickhouse_query",
      state: "output-available",
      output: { ok: true, rows: new Array(200).fill({}), truncated: true },
    })?.detail,
  ).toBe("200 rows (capped)");

  expect(
    toWorkStep({
      type: "tool-clickhouse_query",
      state: "output-available",
      output: { ok: true, rows: [] },
    })?.detail,
  ).toBe("0 rows");
});

test("ignores parts that are not tool calls", () => {
  expect(toWorkStep({ type: "text" })).toBeNull();
  expect(toWorkStep({ type: "step-start" })).toBeNull();
});

test("formats durations at each scale", () => {
  expect(formatDuration(412)).toBe("412ms");
  expect(formatDuration(1_400)).toBe("1.4s");
  expect(formatDuration(12_000)).toBe("12s");
  expect(formatDuration(125_000)).toBe("2m 05s");
});

test("summarizes the work as the collapsed trigger reads it", () => {
  const done = { toolName: "clickhouse_query", state: "done" } as const;
  const failed = { toolName: "clickhouse_query", state: "failed" } as const;

  expect(workSummary([done, done, done, done], 12_000)).toBe(
    "Worked for 12s · 4 queries",
  );
  expect(workSummary([done], 900)).toBe("Worked for 900ms · 1 query");
  expect(workSummary([done, failed], 2_000)).toBe(
    "Worked for 2.0s · 2 queries · 1 retried",
  );
  // A restored conversation has no timing; "0ms" would be a lie.
  expect(workSummary([done], null)).toBe("Worked · 1 query");
});
