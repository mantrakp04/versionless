import type { Exchange, Versionless } from "@versionless/core";
import { HEADERS, isTransformableJson, toWireError } from "@versionless/core";
import { Elysia, ElysiaCustomStatusResponse, status } from "elysia";

const ADAPTER = "elysia";

interface State {
  exchange: Exchange;
  finished?: boolean;
}

interface ElysiaishCtx {
  request: Request;
  path: string;
  route?: string;
  body?: unknown;
  set: { status?: number | string; headers: Record<string, string | number | undefined> };
}

function open(v: Versionless, ctx: ElysiaishCtx): Exchange | Promise<Exchange> {
  return v.openExchange({
    method: ctx.request.method,
    path: ctx.path,
    // elysia 1.4 exposes the matched route pattern ("/users/:id") as ctx.route.
    matchedRoute: ctx.route ?? undefined,
    getHeader: (name) => ctx.request.headers.get(name),
    adapter: ADAPTER,
    appCtx: ctx,
  });
}

function statusOf(set: ElysiaishCtx["set"]): number {
  return typeof set.status === "number" ? set.status : 200;
}

function identity(ex: Exchange): boolean {
  return ex.transformCount === 0 && ex.routeKey === null;
}

async function finish(
  state: State,
  status: number,
  waitUntil?: (pending: Promise<void>) => void,
): Promise<void> {
  if (state.finished) return;
  state.finished = true;
  let flushed: Promise<void> | undefined;
  state.exchange.finish({
    status,
    waitUntil: (pending) => {
      flushed = pending;
      waitUntil?.(pending);
    },
  });
  // Elysia detaches after-response hooks from the request promise. Awaiting
  // here keeps serverless runtimes alive even when their background-task
  // handoff is unavailable or runs after the response has been committed.
  await flushed;
}

function errorStatus(ctx: { error: unknown; set: ElysiaishCtx["set"] }): number {
  if (typeof ctx.set.status === "number") return ctx.set.status;
  if (ctx.error instanceof ElysiaCustomStatusResponse) return Number(ctx.error.code);
  return 500;
}

export interface VersionlessElysiaOptions {
  /** Platform background-task handoff, such as `waitUntil` from `@vercel/functions`. */
  waitUntil?: (pending: Promise<void>) => void;
}

/** Global versioning plugin: `app.use(versionless(v))` before defining routes. */
export function versionless(v: Versionless, options: VersionlessElysiaOptions = {}) {
  return new Elysia({ name: "versionless" })
    .derive({ as: "global" }, async (ctx) => {
      const exchange = await open(v, ctx as ElysiaishCtx);
      // Direct assignment (in addition to the derived return) so the state
      // survives the gone short-circuit below and error paths.
      (ctx as unknown as { versionless: State }).versionless = { exchange };
      for (const [k, val] of Object.entries(exchange.responseHeaders)) {
        ctx.set.headers[k] = val;
      }
      if (exchange.gone) {
        ctx.set.headers[HEADERS.error] = exchange.gone.body.code;
        return status(410, exchange.gone.body) as never;
      }
      return { versionless: { exchange } };
    })
    .onTransform({ as: "global" }, async (ctx) => {
      const st = (ctx as unknown as { versionless?: State }).versionless;
      if (!st || st.exchange.passthrough || identity(st.exchange)) return;
      const body: unknown = ctx.body;
      if (body === null || typeof body !== "object") return;
      if (body instanceof Uint8Array || body instanceof ArrayBuffer || body instanceof Blob) return;
      if (
        !isTransformableJson(
          ctx.request.headers.get("content-type"),
          ctx.request.headers.get("content-length"),
        )
      ) {
        return;
      }
      (ctx as { body: unknown }).body = await st.exchange.up(body);
    })
    // mapResponse (not afterHandle) so route `response` schemas validate the
    // CURRENT shape the handler returned; down-transforms apply after
    // validation, producing the pinned client's wire shape. `set.headers`
    // (version/sunset etc.) still merge into Responses returned from here.
    .mapResponse({ as: "global" }, async (ctx) => {
      const st = (ctx as unknown as { versionless?: State }).versionless;
      if (!st) return;
      try {
        const ex = st.exchange;
        if (ex.passthrough || ex.transformCount === 0) return;
        let r: unknown = (ctx as unknown as { response: unknown }).response;
        if (r instanceof ElysiaCustomStatusResponse) r = r.response;
        if (r === null || typeof r !== "object") return;
        const s = statusOf(ctx.set);
        if (r instanceof Response) {
          // Only buffered JSON responses under the cap are transformed; streams
          // (no content-length) and non-JSON pass through untouched.
          const ct = r.headers.get("content-type");
          const len = r.headers.get("content-length");
          if (!len || !isTransformableJson(ct, len)) return;
          const payload: unknown = await r.clone().json().catch(() => undefined);
          if (payload === null || typeof payload !== "object") return;
          const t = r.status >= 400 ? await ex.downError(payload) : await ex.down(payload);
          const headers = new Headers(r.headers);
          headers.delete("content-length");
          return new Response(JSON.stringify(t), { status: r.status, headers });
        }
        if (r instanceof ReadableStream) return;
        const t = s >= 400 ? await ex.downError(r) : await ex.down(r);
        return new Response(JSON.stringify(t), {
          status: s,
          headers: { "content-type": "application/json" },
        });
      } finally {
        await finish(st, statusOf(ctx.set), options.waitUntil);
      }
    })
    .onError({ as: "global" }, async (ctx) => {
      const st = (ctx as unknown as { versionless?: State }).versionless;
      try {
        const wire = toWireError(ctx.error);
        if (wire) {
          ctx.set.status = wire.status;
          Object.assign(ctx.set.headers, wire.headers);
          return wire.body;
        }
        if (!st || st.exchange.passthrough || st.exchange.transformCount === 0) return;
        // Thrown status(code, body) errors carry a JSON-able body we can down-map.
        if (ctx.error instanceof ElysiaCustomStatusResponse) {
          const body: unknown = ctx.error.response;
          if (body !== null && typeof body === "object") {
            return status(ctx.error.code as number, (await st.exchange.downError(body)) as never);
          }
        }
      } finally {
        if (st) await finish(st, errorStatus(ctx), options.waitUntil);
      }
    });
}

/**
 * Registers alias routes for every registered rewrite (e.g. "GET /orgs/:id")
 * on the consuming app; old-pinned clients hitting the old path are
 * re-dispatched via `app.handle` to the rewritten target. Required because a
 * plugin hook never runs for unrouted paths (they 404 before the hooks fire).
 */
export function versionlessRewrites<App extends Elysia<any, any, any, any, any, any, any>>(
  v: Versionless,
  app: App,
): App {
  for (const { method, path } of v.rewrites()) {
    (app as Elysia).route(method as "GET", path, async (ctx) => {
      const st = (ctx as unknown as { versionless?: State }).versionless;
      const exchange = st?.exchange ?? (await open(v, ctx as ElysiaishCtx));
      const target = exchange.rewrite;
      // Current-version clients: the old path no longer exists.
      if (!target) return status(404, "NOT_FOUND");
      // Elysia has already consumed/parsed the body, so the re-dispatch
      // request is rebuilt from the parsed body rather than the raw stream.
      const url = new URL(ctx.request.url);
      url.pathname = target.path;
      const init: RequestInit = { method: target.method, headers: ctx.request.headers };
      if (target.method !== "GET" && target.method !== "HEAD" && ctx.body !== undefined) {
        init.body = typeof ctx.body === "string" ? ctx.body : JSON.stringify(ctx.body);
      }
      return app.handle(new Request(url.toString(), init));
    });
  }
  return app;
}
