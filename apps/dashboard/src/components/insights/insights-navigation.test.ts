import { expect, test } from "bun:test";

import {
  getInsightsProjectId,
  preserveInsightsSearch,
} from "./insights-navigation";
import { parseInsightsTimeRangeDays } from "./time-range-control";

test("shows project navigation throughout an insights project", () => {
  expect(getInsightsProjectId("/insights/project-123")).toBe("project-123");
  expect(getInsightsProjectId("/insights/project-123/traces")).toBe(
    "project-123",
  );
});

test("hides project navigation outside an insights project", () => {
  expect(getInsightsProjectId("/")).toBeNull();
  expect(getInsightsProjectId("/keys")).toBeNull();
});

test("preserves the selected time range across insights navigation", () => {
  const search = { days: 7 as const };

  expect(preserveInsightsSearch(search)).toEqual({ days: 7 });
  expect(parseInsightsTimeRangeDays("7")).toBe(7);
  expect(parseInsightsTimeRangeDays(undefined)).toBe(30);
});
