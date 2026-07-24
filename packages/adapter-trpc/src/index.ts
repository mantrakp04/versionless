import type {
  TRPCDefaultErrorShape,
  TRPCMiddlewareFunction,
} from "@trpc/server";
import { TRPCError } from "@trpc/server";
import type { Exchange, Versionless } from "@versionless/core";
import { stashFrom, toWireError, warnMissingStash } from "@versionless/core";

// ---------------------------------------------------------------------------
// Context (shared with the oRPC adapter — hoisted into core)

export {
  versionlessContext,
  type VersionlessContext,
  type VersionlessStash,
} from "@versionless/core";

function finishAuxiliaryExchange(exchange: Exchange, status: number): void {
  exchange.finish({ status, emitTelemetry: false });
}

// ---------------------------------------------------------------------------
// Middleware

/**
 * Middleware function shape compatible with `t.procedure.use(...)`.
 * Context/meta/input generics are widened; the middleware never narrows or
 * overrides any of them.
 */
export type VersionlessMiddleware = TRPCMiddlewareFunction<
  object,
  unknown,
  object,
  object,
  unknown
>;

/**
 * Per-procedure versioning middleware. Attach it BEFORE `.input(...)` so the
 * `up` transform runs pre-validation (it overrides `getRawInput` for the rest
 * of the chain, mirroring tRPC's own input middleware mechanism):
 *
 * ```ts
 * const proc = t.procedure.use(versionlessMiddleware());
 * ```
 *
 * The instance is read from `ctx.versionless` (see {@link versionlessContext});
 * pass `v` explicitly to override it.
 */
export function versionlessMiddleware(v?: Versionless): VersionlessMiddleware {
  return async (opts) => {
    const stash = stashFrom(opts.ctx);
    if (!stash) {
      warnMissingStash(
        "versionless: ctx.versionless missing — did you call versionlessContext in createContext? Falling back to current version",
      );
      return opts.next();
    }
    const instance = v ?? stash.v;

    let exchange;
    try {
      exchange = await instance.openExchange({
        method: "POST",
        path: `/trpc/${opts.path}`,
        procedure: opts.path,
        getHeader: stash.getHeader,
        adapter: "trpc",
        appCtx: opts.ctx,
      });
    } catch (err) {
      // Covers VersionResolutionError AND FutureVersionError ("reject"
      // policy) — both are client errors, mapped to tRPC's 400.
      const wire = toWireError(err);
      if (wire) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: wire.body.message,
          cause: err,
        });
      }
      throw err;
    }

    if (exchange.gone) {
      // tRPC has no GONE code; PRECONDITION_FAILED (412) is the closest.
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: exchange.gone.body.error,
        cause: exchange.gone.body,
      });
    }

    const ex = exchange;
    const result = await opts.next({
      getRawInput: async () => ex.up(await opts.getRawInput()),
    });

    const final = result.ok
      ? { ...result, data: await ex.down(result.data) }
      : result;

    ex.finish({ status: result.ok ? 200 : 500 });

    return final;
  };
}

// ---------------------------------------------------------------------------
// Error formatter

/**
 * Formatter function shape for `initTRPC.create({ errorFormatter })`.
 * tRPC v11 error formatters are synchronous (`ErrorFormatter` returns `TShape`,
 * not a promise), so async `error.down` chains cannot be applied here — the
 * shape is returned unchanged in that case.
 */
export type VersionlessErrorFormatter = (opts: {
  shape: TRPCDefaultErrorShape;
  path: string | undefined;
  ctx: object | undefined;
}) => TRPCDefaultErrorShape;

/**
 * Applies registered `error.down` transforms to the tRPC error shape for old
 * clients:
 *
 * ```ts
 * initTRPC.context<Ctx>().create({ errorFormatter: versionlessErrorFormatter(v) })
 * ```
 *
 * Requires `versionlessContext` in `createContext`. Because v11 formatters are
 * sync-only, the shape is passed through untouched when the resolve chain or
 * the `error.down` transforms are asynchronous.
 */
export function versionlessErrorFormatter(
  v: Versionless,
): VersionlessErrorFormatter {
  return ({ shape, path, ctx }) => {
    const stash = stashFrom(ctx);
    if (!stash) return shape;
    let exchange: Exchange | undefined;
    try {
      const opened = (v ?? stash.v).openExchange({
        method: "POST",
        path: `/trpc/${path ?? ""}`,
        ...(path !== undefined ? { procedure: path } : {}),
        getHeader: stash.getHeader,
        adapter: "trpc",
      });
      // Async apiKey resolver: cannot await inside a sync formatter.
      if (opened instanceof Promise) {
        void opened
          .then((resolved) =>
            finishAuxiliaryExchange(resolved, shape.data.httpStatus),
          )
          .catch(() => {});
        return shape;
      }
      exchange = opened;
      const transformed = exchange.downError(shape);
      // Async error.down transform: cannot await inside a sync formatter.
      if (transformed instanceof Promise) {
        const pendingExchange = exchange;
        exchange = undefined;
        void transformed
          .finally(() =>
            finishAuxiliaryExchange(pendingExchange, shape.data.httpStatus),
          )
          .catch(() => {});
        return shape;
      }
      return transformed as TRPCDefaultErrorShape;
    } catch {
      return shape;
    } finally {
      if (exchange) {
        finishAuxiliaryExchange(exchange, shape.data.httpStatus);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Response meta

/** ResponseMeta function shape for `fetchRequestHandler({ responseMeta })`. */
export type VersionlessResponseMeta = (opts: {
  ctx?: object | undefined;
}) => { headers?: Record<string, string> };

/**
 * Emits the version-negotiation headers plus RFC 8594 `Sunset` / RFC 9745
 * `Deprecation` for requests pinned to a sunsetting version:
 *
 * ```ts
 * fetchRequestHandler({ ..., responseMeta: versionlessResponseMeta(v) })
 * ```
 *
 * Resolves the version + response headers from the context stash without a
 * full per-procedure exchange (no procedure — routeKey null — so no transform
 * pipelines are compiled). Sync-only, like the formatter: with an async apiKey
 * resolver no headers are added.
 */
export function versionlessResponseMeta(
  v: Versionless,
): VersionlessResponseMeta {
  return ({ ctx }) => {
    const stash = stashFrom(ctx);
    if (!stash) return {};
    let exchange: Exchange | undefined;
    try {
      const opened = (v ?? stash.v).openExchange({
        method: "POST",
        path: "/trpc",
        getHeader: stash.getHeader,
        adapter: "trpc",
      });
      if (opened instanceof Promise) {
        void opened
          .then((resolved) => finishAuxiliaryExchange(resolved, 200))
          .catch(() => {});
        return {};
      }
      exchange = opened;
      return { headers: { ...exchange.responseHeaders } };
    } catch {
      return {};
    } finally {
      if (exchange) finishAuxiliaryExchange(exchange, 200);
    }
  };
}
