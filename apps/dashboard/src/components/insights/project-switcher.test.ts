import { expect, test } from "bun:test";

import { projectRouteForPathname } from "./project-switcher";

test("preserves the active insights page when switching projects", () => {
  expect(projectRouteForPathname("/insights/project-1")).toBe(
    "/insights/$projectId",
  );
  expect(projectRouteForPathname("/insights/project-1/sunset")).toBe(
    "/insights/$projectId/sunset",
  );
  expect(projectRouteForPathname("/insights/project-1/overhead")).toBe(
    "/insights/$projectId/overhead",
  );
  expect(projectRouteForPathname("/insights/project-1/traces")).toBe(
    "/insights/$projectId/traces",
  );
  expect(projectRouteForPathname("/insights/project-1/telemetry")).toBe(
    "/insights/$projectId/telemetry",
  );
});
