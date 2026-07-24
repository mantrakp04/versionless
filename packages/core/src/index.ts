import { PipelineCache } from "./compiler";
import { openExchange } from "./exchange";
import { splitRouteKey } from "./matcher";
import { ChangeRegistry } from "./registry";
import { getScheme } from "./scheme";
import { SunsetGate } from "./sunset";
import { httpOtlpLogsSink, TelemetryHub } from "./telemetry";
import {
  createCaptureTracing,
  fanoutTracing,
  httpOtlpTraceSink,
} from "./trace-capture";
import type {
  Change,
  ChangeSpec,
  ExchangeInput,
  Jump,
  JumpSpec,
  SunsetOptions,
  Tracing,
  VersionedApi,
  Versionless,
  VersionlessConfig,
} from "./types";

export * from "./errors";
export { compilePipeline, walkPath, type CompiledPipeline } from "./compiler";
export {
  stashFrom,
  versionlessContext,
  warnMissingStash,
  type VersionlessContext,
  type VersionlessStash,
} from "./context";
export {
  buildRewriteRequest,
  DEFAULT_MAX_TRANSFORM_BYTES,
  downgradeResponse,
  HEADERS,
  isTransformableJson,
  runFetchExchange,
  runRewriteExchange,
  toWireError,
  upgradeRequest,
  withResponseHeaders,
  type FetchExchangeOptions,
  type WireError,
} from "./http";
export {
  deepEqual,
  PROBE_KEY,
  verifyChain,
  verifyChange,
  type IntegrityIssue,
  type VerifyReport,
} from "./integrity";
export {
  compilePattern,
  expandPath,
  normalizeRouteKey,
  splitRouteKey,
} from "./matcher";
export { ChangeRegistry } from "./registry";
export { dateScheme, getScheme, semverScheme, type VersionScheme } from "./scheme";
export {
  consoleSink,
  httpOtlpLogsSink,
  rateSample,
  TelemetryHub,
  type HttpOtlpLogsSinkOptions,
} from "./telemetry";
export {
  capturedTracesToOtlp,
  telemetryEventsToOtlp,
} from "./otlp";
export type * from "./otlp";
export {
  createCaptureTracing,
  fanoutTracing,
  httpOtlpTraceSink,
  type CapturedSpan,
  type CapturedTrace,
  type CaptureTracingOptions,
  type HttpOtlpTraceSinkOptions,
  type TraceSink,
} from "./trace-capture";
export type * from "./types";
export type {
  ChainError,
  ClientTypes,
  CurrentShape,
  KnownVersion,
  RouteClientTypes,
} from "./client-types";

const DEFAULT_OTLP_LOGS_URL = "https://ingest.versionless.dev/v1/logs";
const DEFAULT_OTLP_TRACES_URL = "https://ingest.versionless.dev/v1/traces";
const DEFAULT_TRACE_SAMPLE = 0.1;

export function createVersionless<const C extends VersionlessConfig>(
  config: C,
): Versionless<C> {
  const scheme = getScheme(config.scheme);
  const registry = new ChangeRegistry(scheme, config.current);
  const pipelines = new PipelineCache(registry);
  const clock = config.clock ?? (() => new Date());
  const sunsetGate = new SunsetGate(registry, clock);
  const hub = new TelemetryHub(
    config.sample,
    config.onSinkError ??
      ((err) => console.warn("[versionless] telemetry sink error:", err)),
  );

  let tracing: Tracing | undefined = config.tracing;
  // Serverless mode: no interval timers; batched sinks drain per response
  // (exchange.finish() self-flushes when immediate).
  const immediate = !!process.env.VERCEL;

  if (config.apiKey) {
    const project = config.project?.trim();
    if (!project) {
      throw new Error(
        "[versionless] `project` is required when `apiKey` enables cloud telemetry.",
      );
    }
    hub.use(
      httpOtlpLogsSink({
        url: config.otlpLogsUrl ?? DEFAULT_OTLP_LOGS_URL,
        apiKey: config.apiKey,
        project,
        immediate,
        onError: config.onSinkError,
      }),
    );

    // Cloud trace capture: SDK-side head sampling, separate from request-log
    // telemetry (and from its `sample` hook). `traces: false` opts out.
    if (config.traces !== false) {
      const traceSink = httpOtlpTraceSink({
        url:
          config.traces?.url ??
          (config.otlpLogsUrl
            ? config.otlpLogsUrl.replace(/\/v1\/logs\/?$/, "/v1/traces")
            : DEFAULT_OTLP_TRACES_URL),
        apiKey: config.apiKey,
        project,
        immediate,
        onError: config.onSinkError,
      });
      const capture = createCaptureTracing({
        sample: config.traces?.sample ?? DEFAULT_TRACE_SAMPLE,
        filter: config.traces?.filter,
        sink: traceSink,
      });
      tracing = tracing ? fanoutTracing([tracing, capture]) : capture;
      hub.useLifecycle({
        flush: () => traceSink.flush?.() ?? Promise.resolve(),
        close: () => traceSink.close?.() ?? Promise.resolve(),
      });
    }
  }

  const instance: Versionless<C> = {
    current: config.current,
    scheme,

    change<const V extends string, const S extends ChangeSpec>(
      version: V,
      spec: S,
    ): Change<V, S> {
      return registry.addChange(version, spec);
    },

    jump(spec: JumpSpec): Jump {
      return registry.addJump(spec);
    },

    sunset(version: string, opts: SunsetOptions): void {
      registry.addSunset(version, opts);
    },

    register<const Cs extends readonly Change[]>(changes: Cs): VersionedApi<C, Cs> {
      // Changes created via v.change() are already registered; this validates
      // the tuple (the type layer relies on ascending order) and attaches the
      // phantom carrier.
      for (let i = 1; i < changes.length; i++) {
        if (scheme.compare(changes[i - 1]!.version, changes[i]!.version) > 0) {
          console.warn(
            `[versionless] register(): changes tuple is not in ascending version order ` +
              `(${changes[i - 1]!.version} before ${changes[i]!.version}). ` +
              `ClientTypes derivations depend on ascending order.`,
          );
          break;
        }
      }
      return Object.assign(Object.create(instance) as Versionless<C>, {
        changes,
      }) as VersionedApi<C, Cs>;
    },

    openExchange(input: ExchangeInput) {
      return openExchange(
        {
          registry,
          pipelines,
          sunsetGate,
          hub,
          resolveChain: config.resolve,
          onFutureVersion: config.onFutureVersion,
          tracing,
          immediate,
        },
        input,
      );
    },

    rewrites() {
      return registry.rewrites.map(({ fromPattern }) =>
        splitRouteKey(fromPattern.source),
      );
    },

    telemetry: {
      use: (sink) => hub.use(sink),
      emit: (event) => hub.emit(event),
      flush: () => hub.flush(),
    },

    _registry: registry,
  };

  return instance;
}
