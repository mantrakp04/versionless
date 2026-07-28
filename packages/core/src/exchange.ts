import { applyChain, type CompiledPipeline, type PipelineCache } from "./compiler";
import { FutureVersionError } from "./errors";
import { fingerprintConsumerKey } from "./fingerprint";
import { HEADERS } from "./http";
import { expandPath, normalizeRouteKey } from "./matcher";
import type { ChangeRegistry } from "./registry";
import { resolveVersion } from "./resolver";
import type { SunsetGate } from "./sunset";
import type { TelemetryHub } from "./telemetry";
import type {
  Exchange,
  ExchangeInput,
  Resolved,
  Tracing,
  TracingSpan,
  TransformCtx,
} from "./types";

export interface ExchangeDeps {
  registry: ChangeRegistry;
  pipelines: PipelineCache;
  sunsetGate: SunsetGate;
  hub: TelemetryHub;
  resolveChain: Parameters<typeof resolveVersion>[0];
  onFutureVersion?: "clamp" | "reject";
  tracing?: Tracing;
  /** Serverless mode: finish() self-flushes batched sinks per response. */
  immediate?: boolean;
}

export function openExchange(
  deps: ExchangeDeps,
  input: ExchangeInput,
): Exchange | Promise<Exchange> {
  const { registry, tracing } = deps;
  if (!registry.isSealed) registry.seal();
  const startedAt = performance.now();

  // Root span for the whole exchange lifetime, parented on the framework's
  // active HTTP span. Ended by finish() (or here on a pre-build throw).
  const root = tracing?.startSpan("versionless.exchange", {
    "versionless.adapter": input.adapter ?? "unknown",
    ...(input.procedure
      ? { "versionless.procedure": input.procedure }
      : { "versionless.method": input.method, "versionless.path": input.path }),
  });

  const resolve = (): Resolved | Promise<Resolved> => {
    if (!tracing || !root) {
      return resolveVersion(deps.resolveChain, input, registry.scheme, registry.current);
    }
    return tracing.withSpan("versionless.resolve", undefined, root, (span) => {
      const r = resolveVersion(deps.resolveChain, input, registry.scheme, registry.current);
      if (r instanceof Promise) {
        return r.then((rr) => {
          setResolveAttrs(span, rr);
          return rr;
        });
      }
      setResolveAttrs(span, r);
      return r;
    });
  };

  try {
    const resolved = resolve();
    if (resolved instanceof Promise) {
      return resolved
        .then((r) => buildExchange(deps, input, r, startedAt, root))
        .catch((err) => {
          root?.recordException(err);
          root?.end();
          throw err;
        });
    }
    return buildExchange(deps, input, resolved, startedAt, root);
  } catch (err) {
    root?.recordException(err);
    root?.end();
    throw err;
  }
}

function setResolveAttrs(span: TracingSpan, r: Resolved): void {
  span.setAttributes({
    "versionless.version.source": r.source,
    "versionless.version": r.version,
    ...(r.requestedVersion
      ? { "versionless.version.requested": r.requestedVersion }
      : {}),
  });
}

function buildExchange(
  deps: ExchangeDeps,
  input: ExchangeInput,
  resolved: Resolved,
  startedAt: number,
  root?: TracingSpan,
): Exchange {
  const { registry, pipelines, sunsetGate, hub, tracing } = deps;

  // Forward compat: the client is pinned ahead of this server's `current`.
  // "reject" makes the mismatch explicit (400); "clamp" (default) serves
  // `current` and advertises the drift via responseHeaders below.
  const ahead = registry.scheme.compare(resolved.version, registry.current) > 0;
  if (ahead && deps.onFutureVersion === "reject") {
    throw new FutureVersionError(
      resolved.requestedVersion ?? resolved.version,
      registry.current,
    );
  }

  const effective = registry.effectiveVersion(
    ahead ? registry.current : resolved.version,
  );
  const sunset = sunsetGate.check(effective);
  // One merged header bag: version negotiation + sunset signals. Adapters
  // apply it wholesale, so no adapter can drop half the contract.
  const responseHeaders: Record<string, string> = {
    [HEADERS.served]: effective,
    ...(ahead
      ? { [HEADERS.requested]: resolved.requestedVersion ?? resolved.version }
      : {}),
    ...sunset.headers,
  };
  // The raw key is a secret and must not reach telemetry storage — only its
  // one-way fingerprint does. See fingerprint.ts.
  const consumerKey = fingerprintConsumerKey(
    resolved.consumerKey ?? input.getHeader(HEADERS.apiKey),
  );

  // Rewrites apply before route matching: a client calling the old path gets
  // re-dispatched to the new one by the adapter, and the re-dispatched
  // request opens its own exchange for the target route.
  let rewrite: Exchange["rewrite"] = null;
  if (!input.procedure) {
    const hit = registry.matchRewrite(input.method, input.path, effective);
    if (hit) {
      rewrite = {
        method: hit.rewrite.toMethod,
        path: expandPath(hit.rewrite.toRoute, hit.params),
      };
    }
  }

  let routeKey: string | null = null;
  if (!rewrite) {
    if (input.procedure) {
      routeKey = `trpc:${input.procedure}`;
      if (!registry.routeChanges(routeKey)) routeKey = null;
    } else if (input.matchedRoute) {
      const key = normalizeRouteKey(`${input.method} ${input.matchedRoute}`);
      routeKey = registry.routeChanges(key) ? key : null;
    } else {
      routeKey = registry.matchChangedRoute(input.method, input.path);
    }
  }

  const pipeline: CompiledPipeline = pipelines.get(routeKey, effective);
  // Telemetry route: procedures always use their canonical `trpc:` key (an
  // empty change chain must not degrade them to raw "/trpc/<path>" strings —
  // samplers and dashboards key on the procedure form). HTTP prefers the
  // matched route PATTERN over the raw path — patterns keep the route
  // dimension low-cardinality and independent of any base-path prefix.
  const fallbackRoute = input.procedure
    ? `trpc:${input.procedure}`
    : input.matchedRoute
      ? normalizeRouteKey(`${input.method} ${input.matchedRoute}`)
      : `${input.method} ${input.path}`;
  const ctx: TransformCtx = {
    version: effective,
    route: routeKey ?? fallbackRoute,
    ctx: input.appCtx,
  };

  root?.setAttributes({
    "versionless.version": effective,
    "versionless.route": ctx.route,
    "versionless.transform_count": pipeline.transformCount,
    ...(resolved.requestedVersion && resolved.requestedVersion !== effective
      ? { "versionless.version.requested": resolved.requestedVersion }
      : {}),
    ...(ahead ? { "versionless.clamped": true } : {}),
    ...(rewrite
      ? { "versionless.rewrite": `${rewrite.method} ${rewrite.path}` }
      : {}),
    ...(sunset.gone
      ? { "versionless.sunset": "gone" }
      : Object.keys(sunset.headers).length > 0
        ? { "versionless.sunset": "warning" }
        : {}),
  });

  return {
    version: effective,
    requestedVersion: resolved.requestedVersion,
    consumerKey,
    routeKey,
    rewrite,
    passthrough: pipeline.passthroughStream,
    transformCount: pipeline.transformCount,
    responseHeaders,
    gone: sunset.gone,
    up(body) {
      if (pipeline.passthroughStream) return body;
      return applyChain(pipeline.ups, "up", body, ctx, tracing, root);
    },
    down(body) {
      if (pipeline.passthroughStream) return body;
      return applyChain(pipeline.downs, "down", body, ctx, tracing, root);
    },
    downError(body) {
      if (pipeline.passthroughStream) return body;
      return applyChain(pipeline.errorDowns, "error", body, ctx, tracing, root);
    },
    finish({ status, latencyMs, emitTelemetry = true, waitUntil }) {
      root?.setAttributes({ "versionless.status": status });
      root?.end();
      if (!emitTelemetry) return;
      hub.emit({
        ts: Date.now(),
        method: input.procedure ? "TRPC" : input.method.toUpperCase(),
        route: ctx.route,
        adapter: input.adapter ?? "unknown",
        version: effective,
        ...(resolved.requestedVersion && resolved.requestedVersion !== effective
          ? { requestedVersion: resolved.requestedVersion }
          : {}),
        versionSource: resolved.source,
        ...(ahead ? { clamped: true } : {}),
        ...(consumerKey ? { consumerKey } : {}),
        latencyMs: latencyMs ?? Math.round(performance.now() - startedAt),
        transformCount: pipeline.transformCount,
        status,
      });
      if (deps.immediate) {
        // Serverless: drain per response, after the emit microtask has fanned
        // the event out to the sinks (emit is queueMicrotask'd).
        const flushed = Promise.resolve()
          .then(() => hub.flush())
          .catch(() => {});
        waitUntil?.(flushed);
      }
    },
    flush() {
      return hub.flush();
    },
  };
}
