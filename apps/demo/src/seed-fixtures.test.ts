import { describe, expect, test } from "bun:test";
import { DEMO_TELEMETRY_ROUTES } from "./api-routes";
import { KNOWN_VERSIONS } from "./releases";
import { createDemoSeedRoutes } from "./seed-fixtures";
import { normalizeRouteKey } from "@versionless/core";

describe("createDemoSeedRoutes", () => {
  test("derives every demo route and release from the registered exchange", () => {
    const routes = createDemoSeedRoutes();

    expect(routes.map((route) => route.route)).toEqual(
      DEMO_TELEMETRY_ROUTES.map((route) =>
        "procedure" in route ? route.key : normalizeRouteKey(route.key),
      ),
    );
    for (const route of routes) {
      expect(Object.keys(route.depthByVersion)).toEqual([...KNOWN_VERSIONS]);
      expect(route.depthByVersion["2026-07-21"]).toBe(0);
    }
  });

  test("uses the direct jump and real transform pipeline depths", () => {
    const routes = createDemoSeedRoutes();
    const byRoute = new Map(routes.map((route) => [route.route, route]));

    expect(byRoute.get("GET /users")?.depthByVersion["2025-01-01"]).toBe(1);
    expect(byRoute.get("GET /users/:*")?.depthByVersion["2025-01-01"]).toBe(2);
    expect(byRoute.get("POST /users")?.depthByVersion["2025-01-01"]).toBe(2);
    expect(byRoute.get("GET /teams")?.depthByVersion["2025-01-01"]).toBe(0);
  });
});
