/**
 * Fetch-standard adapter kit. Everything here speaks WHATWG Request/Response
 * only (web standards, allowed in core) — it is the shared surface the HTTP
 * adapters build on: canonical header names, the JSON transformability rule,
 * request/response body transforms, rewrite re-dispatch, wire-error mapping,
 * and a generic fetch runner for handler-wrapping adapters.
 */
import { FutureVersionError, VersionResolutionError } from "./errors";
import type { Exchange, ExchangeInput, Versionless } from "./types";

/**
 * Canonical wire header names. A protocol contract shared by core, every
 * adapter, and the client SDK — never re-declare these as string literals.
 */
export const HEADERS = {
  /** Request: the client's pinned API version. */
  version: "x-api-version",
  /** Response: the effective version this response was served as. */
  served: "x-api-version-served",
  /** Response: the raw requested version, when the request was clamped. */
  requested: "x-api-version-requested",
  /** Request: the API consumer's key (telemetry grouping — never a secret). */
  apiKey: "x-api-key",
  /** Response: stable machine-readable versionless error code. */
  error: "x-versionless-error",
} as const;

/** Only JSON bodies up to this size are transformed; larger ones pass through. */
export const DEFAULT_MAX_TRANSFORM_BYTES = 1024 * 1024;

/**
 * The one canonical transformability rule: a JSON content type, and no
 * declared content-length above the cap. Bodies without a declared length are
 * admitted here and re-checked against the cap after buffering.
 */
export function isTransformableJson(
  contentType: string | null | undefined,
  contentLength: string | null | undefined,
  maxBytes: number = DEFAULT_MAX_TRANSFORM_BYTES,
): boolean {
  if (!contentType?.toLowerCase().includes("application/json")) return false;
  if (contentLength && Number(contentLength) > maxBytes) return false;
  return true;
}

/** Up-transform a JSON request body, returning the request the handler should see. */
export async function upgradeRequest(
  request: Request,
  exchange: Exchange,
): Promise<Request> {
  if (request.body === null || request.bodyUsed) return request;
  if (
    !isTransformableJson(
      request.headers.get("content-type"),
      request.headers.get("content-length"),
    )
  ) {
    return request;
  }
  const text = await request.text();
  // The original body is consumed past this point; every path rebuilds.
  if (!text || text.length > DEFAULT_MAX_TRANSFORM_BYTES) {
    return new Request(request, { body: text });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Malformed JSON despite the content type: hand it back untouched so the
    // handler surfaces its own parse error.
    return new Request(request, { body: text });
  }
  const upped = await exchange.up(parsed);
  return new Request(request, { body: JSON.stringify(upped) });
}

/** Down-transform a JSON response body, preserving status and headers. */
export async function downgradeResponse(
  res: Response,
  exchange: Exchange,
): Promise<Response> {
  if (res.body === null || res.bodyUsed) return res;
  if (
    !isTransformableJson(res.headers.get("content-type"), res.headers.get("content-length"))
  ) {
    return res;
  }
  const text = await res.text();
  const rebuild = (body: string): Response => {
    const next = new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    // Let the runtime recompute the length for the new body.
    next.headers.delete("content-length");
    return next;
  };
  if (!text || text.length > DEFAULT_MAX_TRANSFORM_BYTES) return rebuild(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return rebuild(text);
  }
  const downed =
    res.status >= 400 ? await exchange.downError(parsed) : await exchange.down(parsed);
  return rebuild(JSON.stringify(downed));
}

/**
 * Apply the exchange's merged response-header contract (version negotiation +
 * sunset signals) to a Response. Handler-created Response headers are mutable;
 * fetch-derived ones are not, so an immutable-headers Response is rebuilt.
 */
export function withResponseHeaders(res: Response, exchange: Exchange): Response {
  const entries = Object.entries(exchange.responseHeaders);
  if (entries.length === 0) return res;
  try {
    for (const [name, value] of entries) res.headers.set(name, value);
    return res;
  } catch {
    const next = new Response(res.body, res);
    for (const [name, value] of entries) next.headers.set(name, value);
    return next;
  }
}

/**
 * Build the re-dispatch request for a rewrite-matched exchange. Returns null
 * when there is no rewrite — the old path no longer exists for this client's
 * version, and the adapter must 404.
 */
export function buildRewriteRequest(
  request: Request,
  rewrite: Exchange["rewrite"],
): Request | null {
  if (!rewrite) return null;
  const url = new URL(request.url);
  url.pathname = rewrite.path;
  let next = new Request(url.toString(), request);
  if (rewrite.method.toUpperCase() !== request.method.toUpperCase()) {
    next = new Request(next, { method: rewrite.method });
  }
  return next;
}

/** Framework-agnostic wire form of a versionless resolution error. */
export interface WireError {
  status: number;
  headers: Record<string, string>;
  body: {
    error: string;
    code: string;
    message: string;
    requested?: string;
    current?: string;
  };
}

/**
 * Map a caught error to its wire shape, or null when it is not a versionless
 * resolution error (rethrow those). Covers VersionResolutionError (invalid
 * pin) and FutureVersionError (pin ahead of current under the "reject"
 * policy) — every adapter's catch path must route through this.
 */
export function toWireError(err: unknown): WireError | null {
  if (err instanceof VersionResolutionError) {
    return {
      status: 400,
      headers: { [HEADERS.error]: err.code },
      body: { error: "invalid_api_version", code: err.code, message: err.message },
    };
  }
  if (err instanceof FutureVersionError) {
    // Forward compat, "reject" policy: the client is pinned ahead of this
    // server. Fail explicitly and tell the client what IS available.
    return {
      status: 400,
      headers: { [HEADERS.error]: err.code, [HEADERS.served]: err.current },
      body: {
        error: "api_version_ahead",
        code: err.code,
        message: err.message,
        requested: err.requested,
        current: err.current,
      },
    };
  }
  return null;
}

export interface FetchExchangeOptions {
  /** Adapter name recorded in telemetry ("nextjs", "tanstack-start", ...). */
  adapter?: string;
  /** The framework's matched route pattern, when it has one. */
  matchedRoute?: string;
  /** Logical pathname override (base-path-aware aliases); defaults to the URL's. */
  path?: string;
  /** Threaded into TransformCtx.ctx. */
  appCtx?: unknown;
}

function openFor(
  v: Versionless,
  request: Request,
  opts: FetchExchangeOptions,
): Exchange | Promise<Exchange> {
  const input: ExchangeInput = {
    method: request.method,
    path: opts.path ?? new URL(request.url).pathname,
    matchedRoute: opts.matchedRoute,
    getHeader: (name) => request.headers.get(name),
    adapter: opts.adapter,
    appCtx: opts.appCtx,
  };
  return v.openExchange(input);
}

function goneResponse(exchange: Exchange): Response {
  const gone = exchange.gone!;
  return withResponseHeaders(
    Response.json(gone.body, {
      status: gone.status,
      headers: { [HEADERS.error]: gone.body.code },
    }),
    exchange,
  );
}

/**
 * Generic fetch runner for handler-wrapping adapters: opens the exchange,
 * maps resolution errors to their wire shape, short-circuits sunset-gone,
 * up/down-transforms JSON bodies around `handler`, applies the response
 * headers, and finishes (timing + telemetry + serverless flush) in core.
 */
export async function runFetchExchange(
  v: Versionless,
  request: Request,
  handler: (request: Request) => Response | Promise<Response>,
  opts: FetchExchangeOptions = {},
): Promise<Response> {
  let exchange: Exchange;
  try {
    exchange = await openFor(v, request, opts);
  } catch (err) {
    const wire = toWireError(err);
    if (wire) {
      return Response.json(wire.body, { status: wire.status, headers: wire.headers });
    }
    throw err;
  }

  let status = 500;
  try {
    if (exchange.gone) {
      status = 410;
      return goneResponse(exchange);
    }

    // Rewrite-matched requests skip body work: the alias handler (see
    // `runRewriteExchange`) re-dispatches and the target runs its own exchange.
    const active =
      !exchange.passthrough && !exchange.rewrite && exchange.transformCount > 0;

    const req = active ? await upgradeRequest(request, exchange) : request;
    let res = await handler(req);
    if (active) res = await downgradeResponse(res, exchange);
    res = withResponseHeaders(res, exchange);
    status = res.status;
    return res;
  } finally {
    exchange.finish({ status });
  }
}

/**
 * Generic fetch runner for rewrite aliases: old-pinned clients are forwarded
 * to the rewrite target (which opens its own exchange for the new path);
 * current clients get a 404 — the old path no longer exists for them.
 */
export async function runRewriteExchange(
  v: Versionless,
  request: Request,
  forward: (request: Request) => Response | Promise<Response>,
  opts: FetchExchangeOptions = {},
): Promise<Response> {
  let exchange: Exchange;
  try {
    exchange = await openFor(v, request, opts);
  } catch (err) {
    const wire = toWireError(err);
    if (wire) {
      return Response.json(wire.body, { status: wire.status, headers: wire.headers });
    }
    throw err;
  }

  let status = 500;
  try {
    if (exchange.gone) {
      status = 410;
      return goneResponse(exchange);
    }
    const req = buildRewriteRequest(request, exchange.rewrite);
    if (!req) {
      status = 404;
      return withResponseHeaders(new Response("Not Found", { status: 404 }), exchange);
    }
    const res = await forward(req);
    status = res.status;
    return res;
  } finally {
    exchange.finish({ status });
  }
}
