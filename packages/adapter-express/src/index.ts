/**
 * Express adapter for versionless.
 *
 * Mount order matters:
 *
 *   app.use(express.json());     // 1. body parser FIRST — only parsed JSON
 *                                //    bodies (objects) are transformed, and we
 *                                //    rely on express.json()'s default 1MB cap
 *   app.use(versionless(v));     // 2. versionless BEFORE routes, and last
 *                                //    among body-touching middleware
 *   app.use(compression());      // 3. compression (and friends) AFTER
 *   app.get("/users/:id", ...);  // 4. routes
 *
 * As global middleware we never see `req.route`, so `matchedRoute` is omitted
 * and core matches the raw path against the set of changed routes itself.
 *
 * Route rewrites mutate `req.url` (preserving the query string) and call
 * `next()` so the router re-matches. v0 note: rewrites preserve the HTTP
 * method — method-changing rewrites are ignored here.
 */
import { HEADERS, toWireError } from "@versionless/core";
import type { Exchange, Versionless } from "@versionless/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/** True for the values we transform: parsed JSON objects/arrays only. */
function isJsonValue(body: unknown): boolean {
  if (Array.isArray(body)) return true;
  if (typeof body !== "object" || body === null) return false;
  if (body instanceof Uint8Array) return false; // Buffer et al.
  const proto = Object.getPrototypeOf(body);
  return proto === Object.prototype || proto === null;
}

export function versionless(v: Versionless): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    let exchange: Exchange;
    try {
      exchange = await v.openExchange({
        method: req.method,
        path: req.path,
        getHeader: (name) => req.get(name) ?? null,
        adapter: "express",
        appCtx: req,
      });
    } catch (err) {
      const wire = toWireError(err);
      if (wire) {
        res.status(wire.status).set(wire.headers).json(wire.body);
        return;
      }
      next(err);
      return;
    }

    // Advanced users can reach the exchange from route handlers.
    res.locals.versionless = exchange;

    // The merged header contract (version negotiation + sunset signals) goes
    // on every response.
    res.set(exchange.responseHeaders);

    // Telemetry fires on response finish (core times the exchange and
    // self-flushes on serverless).
    res.on("finish", () => {
      exchange.finish({ status: res.statusCode });
    });

    if (exchange.gone) {
      res.status(410).set(HEADERS.error, exchange.gone.body.code).json(exchange.gone.body);
      return;
    }

    if (exchange.rewrite) {
      // Preserve the original query string; the router re-matches on req.url.
      const qIndex = req.url.indexOf("?");
      const search = qIndex === -1 ? "" : req.url.slice(qIndex);
      req.url = exchange.rewrite.path + search;
      next();
      return;
    }

    // No changes touch this route (or it's a stream opt-out): headers and
    // telemetry are set, but skip all body work.
    if (exchange.passthrough || exchange.routeKey === null) {
      next();
      return;
    }

    // Request up: only parsed JSON bodies (requires express.json() before us).
    if (isJsonValue(req.body)) {
      try {
        req.body = await exchange.up(req.body);
      } catch (err) {
        next(err);
        return;
      }
    }

    // Response down: per-request monkey-patch of res.json/res.send. Bound
    // originals live in locals so the patch never leaks across requests.
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    res.locals.versionlessOriginals = { json: originalJson, send: originalSend };

    const applyDown = (body: unknown) =>
      res.statusCode >= 400 ? exchange.downError(body) : exchange.down(body);

    res.json = (body?: unknown) => {
      res.json = originalJson; // restore before the async hop
      if (!isJsonValue(body)) return originalJson(body);
      void (async () => {
        try {
          originalJson(await applyDown(body));
        } catch (err) {
          next(err);
        }
      })();
      return res;
    };

    res.send = (body?: unknown) => {
      // Only intercept object payloads; strings/buffers (incl. the serialized
      // output of the original res.json) pass straight through.
      if (!isJsonValue(body)) return originalSend(body);
      res.send = originalSend;
      void (async () => {
        try {
          originalJson(await applyDown(body));
        } catch (err) {
          next(err);
        }
      })();
      return res;
    };

    next();
  };
}
