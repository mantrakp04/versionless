/**
 * TanStack Start adapter for versionless.
 *
 * Server route handlers are wrapped where they're defined — request
 * middleware can't swap the body a handler reads, so the adapter wraps the
 * `server.handlers` map of a route file:
 *
 * ```ts
 * export const Route = createFileRoute("/users/$id")({
 *   server: {
 *     handlers: versionless(v, {
 *       GET: async ({ request, params }) => Response.json(...),
 *     }, { route: "/users/$id" }),
 *   },
 * });
 * ```
 *
 * `route` is optional: when given (TanStack `$param` or `:param` style) core
 * matches it directly; when omitted core falls back to matching the raw
 * request path against the set of changed routes, like the Express adapter.
 *
 * All exchange behavior (body transforms, response headers, wire errors,
 * telemetry, serverless flush) lives in core's fetch runner.
 */
import { runFetchExchange, runRewriteExchange } from "@versionless/core";
import type { Versionless } from "@versionless/core";

const ADAPTER = "tanstack-start";

/** Server route handler: `({ request, params, ... }) => Response`. */
export type ServerRouteHandler<Ctx extends { request: Request } = { request: Request }> = (
  ctx: Ctx,
) => Response | Promise<Response>;

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];

export type ServerRouteHandlers<Ctx extends { request: Request } = { request: Request }> =
  Partial<Record<Method, ServerRouteHandler<Ctx>>>;

export interface VersionlessOptions {
  /**
   * The file's route pattern, e.g. "/users/$id" (TanStack style) or
   * "/users/:id". Optional — without it core matches the raw path.
   */
  route?: string;
}

/** "/files/$" -> "/files/*", "/users/$id" -> "/users/:id". */
function normalizeTanStackRoute(route: string): string {
  return route.replace(/\$$/, "*").replace(/\$([A-Za-z0-9_]+)/g, ":$1");
}

/**
 * Wraps a route file's `server.handlers` map:
 *
 * ```ts
 * server: { handlers: versionless(v, { GET: ..., POST: ... }) }
 * ```
 */
export function versionless<
  Ctx extends { request: Request },
  H extends ServerRouteHandlers<Ctx>,
>(
  v: Versionless,
  handlers: H,
  opts?: VersionlessOptions,
): { [K in keyof H]: ServerRouteHandler<Ctx> } {
  const matchedRoute = opts?.route ? normalizeTanStackRoute(opts.route) : undefined;
  const wrapped: ServerRouteHandlers<Ctx> = {};
  for (const method of METHODS) {
    const handler = handlers[method];
    if (handler) {
      wrapped[method] = (ctx) =>
        runFetchExchange(
          v,
          ctx.request,
          (req) => handler(req === ctx.request ? ctx : { ...ctx, request: req }),
          { adapter: ADAPTER, matchedRoute, appCtx: ctx },
        );
    }
  }
  return wrapped as { [K in keyof H]: ServerRouteHandler<Ctx> };
}

/**
 * Alias handler for a `rewrite:` change. File routing means the old path
 * needs its own route file; create one that re-dispatches to the new route's
 * wrapped handler:
 *
 * ```ts
 * // routes/orgs/$id.ts  (rewrite: "GET /orgs/:id" -> "GET /teams/:id")
 * export const Route = createFileRoute("/orgs/$id")({
 *   server: { handlers: { GET: versionlessAlias(v, teamsGET) } },
 * });
 * ```
 *
 * Old-pinned clients are forwarded to the target (which opens its own
 * exchange for the new path); current clients get a 404 — the old path no
 * longer exists for them. v0 note: `params` are passed through as-is, so
 * rewrites that rename path params need the target to read from the URL.
 */
export function versionlessAlias<Ctx extends { request: Request }>(
  v: Versionless,
  target: ServerRouteHandler<Ctx>,
  opts?: VersionlessOptions,
): ServerRouteHandler<Ctx> {
  // Like the main wrapper, `route` lets core match the file's pattern
  // directly — required when the app serves under a base path (e.g. /demo),
  // where the raw URL path would never match the rewrite's old route. Rewrite
  // matching extracts params from the PATH, so the alias re-derives the
  // logical (prefix-free) path by taking as many trailing segments of the
  // real path as the pattern has.
  const matchedRoute = opts?.route ? normalizeTanStackRoute(opts.route) : undefined;
  const logicalPath = (pathname: string): string => {
    if (!matchedRoute || matchedRoute.includes("*")) return pathname;
    const patternSegments = matchedRoute.split("/").filter(Boolean).length;
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length <= patternSegments) return pathname;
    return `/${segments.slice(-patternSegments).join("/")}`;
  };
  return (ctx) =>
    runRewriteExchange(
      v,
      ctx.request,
      (req) => target({ ...ctx, request: req }),
      {
        adapter: ADAPTER,
        matchedRoute,
        path: logicalPath(new URL(ctx.request.url).pathname),
        appCtx: ctx,
      },
    );
}
