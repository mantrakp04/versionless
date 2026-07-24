import { expect, test } from "bun:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { insightsTimeRangeNavigationOptions } from "./use-insights-time-range";

test("updates the time range without leaving the current insights page", () => {
  const rootRoute = createRootRoute();
  const insightsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "insights/$projectId",
  });
  const telemetryRoute = createRoute({
    getParentRoute: () => insightsRoute,
    path: "telemetry",
  });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: ["/insights/project-1/telemetry?days=7"],
    }),
    routeTree: rootRoute.addChildren([
      insightsRoute.addChildren([telemetryRoute]),
    ]),
  });

  const nextLocation = router.buildLocation(
    insightsTimeRangeNavigationOptions(30),
  );

  expect(nextLocation.pathname).toBe("/insights/project-1/telemetry");
  expect(nextLocation.search).toEqual({ days: 30 });
});
