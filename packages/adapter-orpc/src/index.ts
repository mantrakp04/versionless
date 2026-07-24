import { ORPCError } from "@orpc/server";
import type { Versionless } from "@versionless/core";
import {
  stashFrom,
  toWireError,
  warnMissingStash,
  withResponseHeaders,
} from "@versionless/core";

const ADAPTER = "orpc";

// ---------------------------------------------------------------------------
// Context (shared with the tRPC adapter — hoisted into core)

export {
  versionlessContext,
  type VersionlessContext,
  type VersionlessStash,
} from "@versionless/core";

// ---------------------------------------------------------------------------
// Client interceptor

/**
 * Options shape of an oRPC handler client interceptor, widened: the adapter
 * reads `context`/`path`/`input` and forwards everything else untouched.
 */
export interface ClientInterceptorOptions {
  context: unknown;
  path: readonly string[];
  input: unknown;
  next(opts?: unknown): Promise<unknown>;
}

export type VersionlessClientInterceptor = (
  opts: ClientInterceptorOptions,
) => Promise<any>;

/**
 * Per-procedure versioning interceptor. oRPC middleware cannot replace the
 * input a handler receives, so the adapter hooks `clientInterceptors` — which
 * run after input decoding and before output encoding, exactly where `up` and
 * `down` belong:
 *
 * ```ts
 * const handler = new RPCHandler(router, {
 *   clientInterceptors: [versionlessClientInterceptor()],
 * });
 * ```
 *
 * The instance is read from `context.versionless` (see
 * {@link versionlessContext}); pass `v` explicitly to override it.
 */
export function versionlessClientInterceptor(
  v?: Versionless,
): VersionlessClientInterceptor {
  return async (opts) => {
    const stash = stashFrom(opts.context);
    const instance = v ?? stash?.v;
    if (!instance || !stash) {
      warnMissingStash(
        "versionless: context.versionless missing — did you spread versionlessContext into the handler context? Falling back to current version",
      );
      return opts.next();
    }

    const procedure = opts.path.join(".");
    let exchange;
    try {
      exchange = await instance.openExchange({
        method: "POST",
        path: `/${opts.path.join("/")}`,
        procedure,
        getHeader: stash.getHeader,
        adapter: ADAPTER,
        appCtx: opts.context,
      });
    } catch (err) {
      // Covers VersionResolutionError AND FutureVersionError ("reject"
      // policy) — both are client errors, mapped to oRPC's 400.
      const wire = toWireError(err);
      if (wire) {
        throw new ORPCError("BAD_REQUEST", {
          message: wire.body.message,
          data: wire.body,
          cause: err,
        });
      }
      throw err;
    }

    if (exchange.gone) {
      throw new ORPCError("GONE", {
        status: 410,
        message: exchange.gone.body.error,
        data: exchange.gone.body,
      });
    }

    let status = 500;
    try {
      const { next, ...rest } = opts;
      // No input, nothing to up-convert — parity with tRPC, which never calls
      // getRawInput for procedures without .input(). Request transforms would
      // otherwise run on `undefined`/`null` (the RPC protocol encodes a
      // missing input as null) and blow up on input-less procedures.
      const input =
        opts.input === undefined || opts.input === null
          ? opts.input
          : await exchange.up(opts.input);
      const output = await next({ ...rest, input });
      const downed = await exchange.down(output);
      status = 200;
      return downed;
    } catch (err) {
      if (err instanceof ORPCError) {
        status = err.status;
        const shape = {
          code: err.code,
          status: err.status,
          message: err.message,
          data: err.data as unknown,
        };
        const downed = (await exchange.downError(shape)) as typeof shape;
        // Empty error chains return the shape by reference; only rebuild the
        // error when a transform actually produced a new one.
        if (downed !== shape) {
          throw new ORPCError(downed.code ?? err.code, {
            status: downed.status ?? err.status,
            message: downed.message ?? err.message,
            data: downed.data,
            cause: err,
          });
        }
      }
      throw err;
    } finally {
      exchange.finish({ status });
    }
  };
}

// ---------------------------------------------------------------------------
// Adapter interceptor (response headers)

/**
 * Options shape of a fetch `adapterInterceptors` entry, widened. This is the
 * only interceptor level that sees the final web `Response` on error paths
 * too — root `interceptors` run below oRPC's error-to-response conversion,
 * so a thrown `ORPCError` (410 gone included) would bypass them.
 */
export interface AdapterInterceptorOptions {
  request: Request;
  next(): Promise<{ matched: boolean; response?: Response | undefined }>;
}

export type VersionlessAdapterInterceptor = (
  opts: AdapterInterceptorOptions,
) => Promise<any>;

/**
 * Emits the version-negotiation headers plus RFC 8594 `Sunset` / RFC 9745
 * `Deprecation` for requests pinned to a sunsetting version:
 *
 * ```ts
 * const handler = new RPCHandler(router, {
 *   adapterInterceptors: [versionlessAdapterInterceptor(v)],
 *   clientInterceptors: [versionlessClientInterceptor()],
 * });
 * ```
 *
 * Resolves the version + response headers without a procedure (routeKey null,
 * so no transform pipelines are compiled). A resolution failure adds no
 * headers — the client interceptor is where errors surface.
 */
export function versionlessAdapterInterceptor(
  v: Versionless,
): VersionlessAdapterInterceptor {
  return async (opts) => {
    let result = await opts.next();
    if (!result?.matched || !result.response) return result;
    try {
      const { request } = opts;
      const exchange = await v.openExchange({
        method: request.method,
        path: new URL(request.url).pathname,
        getHeader: (name) => request.headers.get(name),
        adapter: ADAPTER,
      });
      // Immutable-headers Responses are rebuilt by the shared helper.
      const res = withResponseHeaders(result.response, exchange);
      if (res !== result.response) result = { ...result, response: res };
      // Auxiliary exchange: the client interceptor emits the real event.
      exchange.finish({ status: res.status, emitTelemetry: false });
    } catch {
      // Response headers are best-effort; never fail a matched response here.
    }
    return result;
  };
}
