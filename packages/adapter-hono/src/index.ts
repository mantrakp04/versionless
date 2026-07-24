import {
  buildRewriteRequest,
  downgradeResponse,
  toWireError,
  upgradeRequest,
  withResponseHeaders,
  HEADERS,
} from "@versionless/core";
import type { Exchange, Versionless } from "@versionless/core";
import type { Context, Hono, MiddlewareHandler } from "hono";

const ADAPTER = "hono";

/**
 * Exchanges opened by the middleware, keyed by the raw Request, so the alias
 * routes registered by `versionlessRewrites` can pick up the rewrite target.
 */
const exchanges = new WeakMap<Request, Exchange>();

/**
 * Inside an `app.use("*")` middleware, `c.req.routePath` is the middleware's
 * own pattern ("/*"), not the handler's. `c.req.matchedRoutes` lists every
 * route matched for this path (middleware first, terminal handler last), so we
 * take the last non-wildcard pattern. When none exists (404, or only catch-all
 * routes matched) we return undefined and core falls back to raw-path matching.
 */
function matchedHandlerRoute(c: Context): string | undefined {
  const routes = c.req.matchedRoutes;
  for (let i = routes.length - 1; i >= 0; i--) {
    const path = routes[i]!.path;
    if (!path.includes("*")) return path;
  }
  return undefined;
}

/** Up-transform a JSON request body in place, leaving anything else untouched. */
async function upgradeRequestBody(c: Context, exchange: Exchange): Promise<void> {
  if (c.req.raw.body === null || c.req.raw.bodyUsed) return;
  const upgraded = await upgradeRequest(c.req.raw, exchange);
  if (upgraded === c.req.raw) return;
  // The pattern Hono's own bodyLimit middleware uses: `.raw` is a plain
  // assignable property. `c.req.bodyCache` must be cleared or the handler's
  // `c.req.json()` could re-serve a pre-transform body.
  c.req.raw = upgraded;
  c.req.bodyCache = {};
}

/**
 * Versionless middleware for Hono. Register it before your routes:
 *
 * ```ts
 * app.use("*", versionless(v));
 * ```
 *
 * Route rewrites additionally need alias routes — see `versionlessRewrites`.
 * A rewrite-matched request without them falls through to Hono's 404.
 */
export function versionless(v: Versionless): MiddlewareHandler {
  return async (c, next) => {
    let exchange: Exchange;
    try {
      exchange = await v.openExchange({
        method: c.req.method,
        path: c.req.path,
        matchedRoute: matchedHandlerRoute(c),
        getHeader: (name) => c.req.header(name) ?? null,
        adapter: ADAPTER,
      });
    } catch (err) {
      const wire = toWireError(err);
      if (wire) {
        return Response.json(wire.body, { status: wire.status, headers: wire.headers });
      }
      throw err;
    }

    exchanges.set(c.req.raw, exchange);
    let status = 500;
    try {
      if (exchange.gone) {
        const res = c.json(exchange.gone.body, 410);
        res.headers.set(HEADERS.error, exchange.gone.body.code);
        status = 410;
        return withResponseHeaders(res, exchange);
      }

      // Rewrites re-dispatch (the inner request runs its own exchange), and
      // empty pipelines are identity — skip body work in both cases.
      const active =
        !exchange.passthrough && !exchange.rewrite && exchange.transformCount > 0;

      if (active) await upgradeRequestBody(c, exchange);
      await next();
      if (active) c.res = await downgradeResponse(c.res, exchange);
      c.res = withResponseHeaders(c.res, exchange);
      status = c.res.status;
    } finally {
      exchange.finish({
        status,
        // Workers/Edge: hand the serverless flush to the platform so it
        // outlives the response. Elsewhere executionCtx throws and the
        // fire-and-forget promise settles on its own.
        waitUntil: (flushed) => {
          try {
            c.executionCtx.waitUntil(flushed);
          } catch {
            // Not on Workers/Edge.
          }
        },
      });
    }
  };
}

/**
 * Registers alias routes for every `rewrite` the instance knows about, so old
 * paths keep resolving for old-pinned clients. Call it after all changes are
 * registered and after routes/middleware are wired:
 *
 * ```ts
 * app.use("*", versionless(v));
 * // ... routes ...
 * versionlessRewrites(v, app);
 * ```
 *
 * Each alias re-dispatches through `app.fetch` when the client's version
 * predates the rewrite, and 404s otherwise (the old path no longer exists for
 * current clients).
 */
export function versionlessRewrites(v: Versionless, app: Hono<any, any, any>): void {
  for (const { method, path } of v.rewrites()) {
    app.on(method, path, (c) => {
      const exchange = exchanges.get(c.req.raw);
      const request = buildRewriteRequest(c.req.raw, exchange?.rewrite ?? null);
      if (!request) return c.notFound();
      return app.fetch(request);
    });
  }
}
