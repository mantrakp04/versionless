import { expect, test } from "bun:test";

import {
  composeTableQuery,
  formatCell,
  isSafeIdentifier,
  splitParams,
} from "./query-sql";

const base = {
  select: "version, count() AS requests",
  from: "otel_logs",
  limit: 25,
  offset: 0,
} as const;

test("composes ORDER BY, LIMIT and OFFSET for ClickHouse and asks for one extra row", () => {
  const composed = composeTableQuery({
    ...base,
    source: "clickhouse",
    where: "Timestamp >= now() - INTERVAL 7 DAY",
    groupBy: "version",
    sort: "requests",
    direction: "desc",
  });

  expect(composed.sql).toContain("WHERE (Timestamp >= now() - INTERVAL 7 DAY)");
  expect(composed.sql).toContain("GROUP BY version");
  expect(composed.sql).toContain("ORDER BY requests DESC");
  expect(composed.sql).toContain("LIMIT {vlLimit: UInt32} OFFSET {vlOffset: UInt32}");
  // limit + 1 is how the table tells "last page" from "there is more" without
  // paying for a COUNT.
  expect(composed.params).toEqual({ vlLimit: 26, vlOffset: 0 });
});

test("binds the ClickHouse search term rather than interpolating it", () => {
  const composed = composeTableQuery({
    ...base,
    source: "clickhouse",
    searchColumn: "consumer_key",
    search: "acme'; DROP TABLE otel_logs; --",
    offset: 50,
  });

  expect(composed.sql).toContain(
    "positionCaseInsensitive(toString(consumer_key), {vlSearch: String}) > 0",
  );
  expect(composed.sql).not.toContain("DROP TABLE");
  expect(composed.params).toEqual({
    vlLimit: 26,
    vlOffset: 50,
    vlSearch: "acme'; DROP TABLE otel_logs; --",
  });
});

test("numbers Postgres placeholders with the search term first", () => {
  const composed = composeTableQuery({
    ...base,
    from: "project_versions",
    source: "postgres",
    searchColumn: "version",
    search: "2026",
    sort: "version",
    direction: "asc",
    offset: 25,
  });

  expect(composed.sql).toContain("version::text ILIKE $1");
  expect(composed.sql).toContain("ORDER BY version ASC");
  expect(composed.sql).toContain("LIMIT $2 OFFSET $3");
  expect(composed.params).toEqual(["2026", 26, 25]);
});

test("numbers Postgres paging from $1 when there is no search", () => {
  const composed = composeTableQuery({
    ...base,
    from: "project_versions",
    source: "postgres",
  });

  expect(composed.sql).toContain("LIMIT $1 OFFSET $2");
  expect(composed.params).toEqual([26, 0]);
});

test("drops a sort or search column that is not a bare identifier", () => {
  // Neither store lets a parameter stand in for a column name, so an unsafe
  // one is dropped rather than bound.
  const composed = composeTableQuery({
    ...base,
    source: "clickhouse",
    sort: "requests; DROP TABLE otel_logs",
    searchColumn: "key) OR 1=1 --",
    search: "anything",
  });

  expect(composed.sql).not.toContain("ORDER BY");
  expect(composed.sql).not.toContain("positionCaseInsensitive");
  expect(composed.sql).not.toContain("DROP TABLE");
  expect(composed.params).toEqual({ vlLimit: 26, vlOffset: 0 });
});

test("ignores a blank search term", () => {
  const composed = composeTableQuery({
    ...base,
    source: "clickhouse",
    searchColumn: "consumer_key",
    search: "   ",
  });

  expect(composed.sql).not.toContain("vlSearch");
  expect(composed.params).toEqual({ vlLimit: 26, vlOffset: 0 });
});

test("isSafeIdentifier accepts aliases and rejects expressions", () => {
  expect(isSafeIdentifier("consumer_key")).toBe(true);
  expect(isSafeIdentifier("_p95")).toBe(true);
  expect(isSafeIdentifier("count()")).toBe(false);
  expect(isSafeIdentifier("a b")).toBe(false);
  expect(isSafeIdentifier("")).toBe(false);
});

test("splitParams routes each shape to the store that can bind it", () => {
  expect(splitParams("clickhouse", { days: 7 })).toEqual({
    named: { days: 7 },
    positional: [],
  });
  // A model that wrote the wrong shape gets an empty binding, not a crash.
  expect(splitParams("clickhouse", [7])).toEqual({ named: {}, positional: [] });
  expect(splitParams("postgres", [7])).toEqual({ named: {}, positional: [7] });
  expect(splitParams("postgres", { days: 7 })).toEqual({
    named: {},
    positional: [],
  });
  expect(splitParams("clickhouse", undefined)).toEqual({
    named: {},
    positional: [],
  });
});

test("formatCell renders each declared format", () => {
  expect(formatCell(null, "number")).toBe("—");
  expect(formatCell(undefined, undefined)).toBe("—");
  expect(formatCell("2026-05-14", undefined)).toBe("2026-05-14");
  expect(formatCell("1234", "number")).toBe("1,234");
  expect(formatCell(12_500, "number")).toBe("12.5K");
  expect(formatCell(4.2, "duration")).toBe("4.2 ms");
  expect(formatCell(412, "duration")).toBe("412 ms");
  expect(formatCell(2_400, "duration")).toBe("2.40 s");
  expect(formatCell(0.045, "percent")).toBe("4.5%");
  expect(formatCell(45, "percent")).toBe("45%");
});

test("formatCell normalizes a ClickHouse timestamp before parsing it", () => {
  // The datetime branch must run before the numeric coercion, or every
  // timestamp string falls through as raw text.
  const rendered = formatCell("2026-07-24 09:30:00", "datetime");
  expect(rendered).not.toBe("2026-07-24 09:30:00");
  expect(rendered).toBe(new Date("2026-07-24T09:30:00Z").toLocaleString());
  // Something that is not a date at all stays legible rather than "Invalid Date".
  expect(formatCell("not-a-date", "datetime")).toBe("not-a-date");
});
