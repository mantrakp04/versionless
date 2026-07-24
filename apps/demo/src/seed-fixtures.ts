import { KNOWN_VERSIONS } from "./releases";
import { DEMO_TELEMETRY_ROUTES } from "./api-routes";
import { demoApi } from "./versions";
import { normalizeRouteKey } from "@versionless/core";

export interface DemoSeedRoute {
  method: string;
  route: string;
  adapter: "tanstack-start" | "orpc";
  depthByVersion: Record<string, number>;
}

function transformDepth(
  route: (typeof DEMO_TELEMETRY_ROUTES)[number],
  version: string,
): number {
  const exchange = demoApi.openExchange({
    method: route.method,
    path: "path" in route ? route.path : `/rpc/${route.procedure}`,
    ...("matchedRoute" in route
      ? { matchedRoute: route.matchedRoute }
      : { procedure: route.procedure }),
    adapter: "procedure" in route ? "orpc" : "tanstack-start",
    getHeader: (name) => (name === "x-api-version" ? version : null),
  });
  if (exchange instanceof Promise) {
    throw new Error("Demo seed planning requires synchronous version resolution");
  }
  exchange.finish({ latencyMs: 0, status: 200, emitTelemetry: false });
  return exchange.transformCount;
}

/**
 * Seed metadata derived from the demo's route catalog and registered exchange
 * planner. Adding a release or changing a transform automatically changes the
 * generated depth map.
 */
export function createDemoSeedRoutes(): DemoSeedRoute[] {
  return DEMO_TELEMETRY_ROUTES.map((route) => ({
    method: route.method,
    route: "procedure" in route ? route.key : normalizeRouteKey(route.key),
    adapter: "procedure" in route ? "orpc" : "tanstack-start",
    depthByVersion: Object.fromEntries(
      KNOWN_VERSIONS.map((version) => [
        version,
        transformDepth(route, version),
      ]),
    ),
  }));
}
