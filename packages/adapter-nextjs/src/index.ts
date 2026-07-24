/**
 * Next.js (App Router) adapter for versionless.
 *
 * Route handlers are wrapped per file — there is no global middleware hook
 * that can transform bodies (Next middleware runs on the edge before the
 * body is available), so the adapter wraps the handlers you export:
 *
 * ```ts
 * // app/users/[id]/route.ts
 * export const { GET, PATCH } = versionless(v, {
 *   GET: async (req, ctx) => Response.json(...),
 *   PATCH: async (req, ctx) => Response.json(...),
 * }, { route: "/users/[id]" });
 * ```
 *
 * `route` is optional: when given (Next `[param]` or `:param` style) core
 * matches it directly; when omitted core falls back to matching the raw
 * request path against the set of changed routes, like the Express adapter.
 *
 * All exchange behavior (body transforms, response headers, wire errors,
 * telemetry, serverless flush) lives in core's fetch runner.
 */
import { runFetchExchange, runRewriteExchange } from "@versionless/core";
import type { Versionless } from "@versionless/core";

const ADAPTER = "nextjs";

/** App Router route handler: `(request, ctx) => Response`. `ctx.params` is a Promise in Next 15. */
export type RouteHandler<Ctx = unknown> = (
  request: Request,
  ctx: Ctx,
) => Response | Promise<Response>;

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];

export type RouteHandlers<Ctx = unknown> = Partial<Record<Method, RouteHandler<Ctx>>>;

export interface VersionlessOptions {
  /**
   * The file's route pattern, e.g. "/users/[id]" (Next style) or
   * "/users/:id". Optional — without it core matches the raw path.
   */
  route?: string;
}

/** "/users/[...slug]" -> "/users/*", "/users/[id]" -> "/users/:id". */
function normalizeNextRoute(route: string): string {
  return route
    .replace(/\[\[?\.\.\.[^\]]+\]\]?/g, "*")
    .replace(/\[([^\]]+)\]/g, ":$1");
}

/**
 * Wraps a route file's handlers:
 *
 * ```ts
 * export const { GET, POST } = versionless(v, { GET: ..., POST: ... });
 * ```
 */
export function versionless<Ctx, H extends RouteHandlers<Ctx>>(
  v: Versionless,
  handlers: H,
  opts?: VersionlessOptions,
): { [K in keyof H]: RouteHandler<Ctx> } {
  const matchedRoute = opts?.route ? normalizeNextRoute(opts.route) : undefined;
  const wrapped: RouteHandlers<Ctx> = {};
  for (const method of METHODS) {
    const handler = handlers[method];
    if (handler) {
      wrapped[method] = (request, ctx) =>
        runFetchExchange(v, request, (req) => handler(req, ctx), {
          adapter: ADAPTER,
          matchedRoute,
          appCtx: ctx,
        });
    }
  }
  return wrapped as { [K in keyof H]: RouteHandler<Ctx> };
}

/**
 * Alias handler for a `rewrite:` change. File routing means the old path
 * needs its own route file; create one that re-dispatches to the new route's
 * wrapped handler:
 *
 * ```ts
 * // app/orgs/[id]/route.ts  (rewrite: "GET /orgs/:id" -> "GET /teams/:id")
 * import { GET as teamsGET } from "../../teams/[id]/route";
 * export const GET = versionlessAlias(v, teamsGET);
 * ```
 *
 * Old-pinned clients are forwarded to the target (which opens its own
 * exchange for the new path); current clients get a 404 — the old path no
 * longer exists for them. v0 note: `ctx` is passed through as-is, so rewrites
 * that rename path params need the target to read params from the URL.
 */
export function versionlessAlias<Ctx>(
  v: Versionless,
  target: RouteHandler<Ctx>,
): RouteHandler<Ctx> {
  return (request, ctx) =>
    runRewriteExchange(v, request, (req) => target(req, ctx), {
      adapter: ADAPTER,
      appCtx: ctx,
    });
}
