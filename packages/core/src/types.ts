import type { VersionScheme } from "./scheme";

// ---------------------------------------------------------------------------
// Transforms

export interface TransformCtx {
  /** The client's effective (normalized) version. */
  version: string;
  /** Canonical route key, e.g. "GET /users/:id" or "trpc:user.get". */
  route: string;
  /** Adapter-supplied app context (Elysia ctx, Express req, tRPC ctx) for lossy/async transforms needing external data. */
  ctx?: unknown;
}

export type TransformFn<I = any, O = any> = (
  body: I,
  ctx: TransformCtx,
) => O | Promise<O>;

// ---------------------------------------------------------------------------
// Schema declarations (consumed by the CLI's coverage checker)

export interface SchemaDeltaOn {
  removed?: string[];
  added?: string[];
  renamed?: Record<string, string>;
  typeChanged?: string[];
  routesRemoved?: string[];
}

export interface ModelDeclaration extends SchemaDeltaOn {
  model: string;
}

export interface SchemaDelta {
  on(model: string, delta: SchemaDeltaOn): SchemaDelta;
}

// ---------------------------------------------------------------------------
// Integrity examples (consumed by `versionless verify` / verifyChange)

export interface ChangeExample {
  /** `up(request.old)` must deep-equal `request.current`. */
  request?: { old: unknown; current: unknown };
  /** `down(response.current)` must deep-equal `response.old`. */
  response?: { current: unknown; old: unknown };
}

// ---------------------------------------------------------------------------
// Changes

export interface ChangeSpec {
  describe: string;
  /** HTTP routes this change applies to, e.g. "GET /users/:id". */
  routes?: readonly string[];
  /** tRPC procedure paths this change applies to, e.g. "user.get". */
  procedures?: readonly string[];
  /** Old wire shape -> new (current) wire shape, applied to requests. */
  request?: { up: TransformFn };
  /** New (current) wire shape -> old wire shape, applied to responses. */
  response?: { down: TransformFn };
  /** Error-body variant of response.down. */
  error?: { down: TransformFn };
  /** tRPC-flavored aliases; normalized onto request/response internally. */
  input?: { up: TransformFn };
  output?: { down: TransformFn };
  /** Route rewrite, e.g. { from: "GET /orgs/:id", to: "GET /teams/:id" }. */
  rewrite?: { from: string; to: string };
  /** The down-conversion loses data; `check` warns instead of failing. */
  lossy?: boolean;
  /** Streaming responses skip body transforms on matched routes. */
  stream?: "passthrough";
  /** Declares the surface diff this change covers, for `versionless check`. */
  schema?: (s: SchemaDelta) => void;
  /**
   * Wire-shape fixtures verified by `versionless verify`: up(old) must equal
   * current, down(current) must equal old, and (unless `lossy`) transforms
   * must preserve fields they don't know about (tolerant-reader probe).
   */
  examples?: readonly ChangeExample[];
  /**
   * Optional phantom wire types, preferred by the type layer over up/down
   * inference. Assign with casts: `wire: {} as { request: { old: OldShape } }`.
   */
  wire?: { request?: { old?: unknown }; response?: { old?: unknown } };
}

export interface Change<
  V extends string = string,
  S extends ChangeSpec = ChangeSpec,
> {
  readonly kind: "change";
  readonly version: V;
  readonly spec: S;
  // Compiled metadata (stable public contract for the CLI):
  readonly describe: string;
  readonly routes: readonly string[];
  readonly lossy: boolean;
  readonly hasUp: boolean;
  readonly hasDown: boolean;
  readonly declarations: readonly ModelDeclaration[];
}

// ---------------------------------------------------------------------------
// Jumps (direct version -> version transforms; take priority over the chain)

export interface JumpSpec {
  from: string;
  to: string;
  describe?: string;
  routes?: readonly string[];
  procedures?: readonly string[];
  request?: { up: TransformFn };
  response?: { down: TransformFn };
  error?: { down: TransformFn };
  lossy?: boolean;
  schema?: (s: SchemaDelta) => void;
  /** Wire-shape fixtures verified by `versionless verify`; see ChangeExample. */
  examples?: readonly ChangeExample[];
}

export interface Jump {
  readonly kind: "jump";
  readonly from: string;
  readonly to: string;
  readonly spec: JumpSpec;
  readonly describe: string;
  readonly routes: readonly string[];
  readonly lossy: boolean;
  readonly hasUp: boolean;
  readonly hasDown: boolean;
  readonly declarations: readonly ModelDeclaration[];
}

// ---------------------------------------------------------------------------
// Resolution

export interface ResolveInput {
  getHeader(name: string): string | null;
  url?: string;
}

export type Resolver =
  | { header: string }
  | { query: string }
  | {
      apiKey: (
        key: string,
      ) => string | null | undefined | Promise<string | null | undefined>;
      /** How to read the consumer's key from the request. Default: Bearer token from Authorization, else x-api-key. */
      keyFrom?: (input: ResolveInput) => string | null;
    }
  | { default: "current" | (string & {}) };

export interface Resolved {
  version: string;
  source: "header" | "query" | "apiKey" | "default";
  /** Raw value the client sent, before normalization to a release version. */
  requestedVersion?: string;
  /** The API consumer's key, surfaced for telemetry. */
  consumerKey?: string;
}

// ---------------------------------------------------------------------------
// Tracing (OpenTelemetry-shaped, zero-dep)

export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, SpanAttributeValue>;

/** Handle to an in-flight span. Structural mirror of an OTel span. */
export interface TracingSpan {
  setAttributes(attrs: SpanAttributes): void;
  recordException(err: unknown): void;
  /** Idempotent; ending twice is a no-op. */
  end(): void;
}

/**
 * Pluggable tracing backend. Core calls this at every pipeline step —
 * resolution, planning, each transform — and never imports a tracing SDK;
 * `@versionless/otel` bridges this interface to `@opentelemetry/api` with
 * proper context propagation.
 */
export interface Tracing {
  /**
   * Open a long-lived span parented on the ambient active context (the
   * framework's HTTP span, when instrumented). Used for the per-request
   * `versionless.exchange` root, ended by `Exchange.finish()`.
   */
  startSpan(name: string, attrs?: SpanAttributes): TracingSpan;
  /**
   * Run `fn` inside a child span of `parent`. The span must be the active
   * context for the duration of `fn` so spans created by user code inside
   * (e.g. a fetch in a transform) nest under it. Ends when `fn` returns or
   * its promise settles; exceptions are recorded and rethrown.
   */
  withSpan<T>(
    name: string,
    attrs: SpanAttributes | undefined,
    parent: TracingSpan | null,
    fn: (span: TracingSpan) => T,
  ): T;
}

// ---------------------------------------------------------------------------
// Telemetry

export interface TelemetryEvent {
  ts: number;
  method: string;
  route: string;
  adapter: string;
  /** Effective (normalized) version served. */
  version: string;
  /** Raw version the client requested, when it differed or was absent. */
  requestedVersion?: string;
  /** The API consumer's key id (from x-api-key etc.) — never a secret. */
  consumerKey?: string;
  latencyMs: number;
  transformCount: number;
  status: number;
}

export interface TelemetrySink {
  /** Must be synchronous, non-blocking, and never throw. */
  record(event: TelemetryEvent): void;
  /** Drain buffered events; called on shutdown and per-response in serverless. */
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Config

export interface VersionlessConfig {
  scheme: "date" | "semver";
  current: string;
  resolve: Resolver[];
  /**
   * Stable project name shown in the versionless dashboard. Required when
   * cloud telemetry is enabled with `apiKey`.
   */
  project?: string;
  /**
   * Versionless cloud API key (secret, `vl_<keyId>_<secret>`). When present,
   * OTLP/HTTP JSON logs and traces are exported automatically. Without it the
   * SDK makes zero network calls.
   */
  apiKey?: string;
  /** OTLP/HTTP JSON logs endpoint. Defaults to the hosted cloud `/v1/logs`. */
  otlpLogsUrl?: string;
  /**
   * Flush cloud telemetry during each request instead of on an interval.
   * Enable for serverless deployments whose runtime may freeze after returning.
   * Defaults to Vercel environment detection.
   */
  serverless?: boolean;
  /** Injectable clock, for testing sunset behavior. */
  clock?: () => Date;
  /** Sampling hook applied before fan-out to sinks. Return false to drop. */
  sample?: (event: TelemetryEvent) => boolean;
  /**
   * Tracing backend; spans every pipeline step (resolve, plan, each
   * transform) under a per-request `versionless.exchange` root. Use
   * `otelTracing()` from `@versionless/otel` to bridge to OpenTelemetry.
   * Absent by default — zero overhead when unset.
   */
  tracing?: Tracing;
  /**
   * Cloud trace capture, separate from (and sampled independently of) event
   * telemetry. When `apiKey` is set, a sampled subset of exchanges ship their
   * versionless spans — only spans core creates; never user spans, headers,
   * or bodies — to the platform's trace view. Head-sampled at the SDK:
   * `sample` (default 0.1) keeps or drops whole exchanges. Set `traces:
   * false` to turn capture off entirely; `url` overrides the traces ingest
   * endpoint for self-hosting. `filter` runs before sampling on the exchange
   * root's attributes (`versionless.method` / `versionless.path` /
   * `versionless.procedure` / `versionless.adapter`) — return false to never
   * capture that exchange (e.g. health checks, self-ingest routes).
   */
  traces?: false | {
    sample?: number;
    url?: string;
    filter?: (rootAttrs: SpanAttributes) => boolean;
  };
  /** Called when a telemetry sink throws/rejects; defaults to console.warn once per sink. */
  onSinkError?: (err: unknown) => void;
  /**
   * Forward-compatibility policy for clients pinned NEWER than `current`
   * (newer SDK than the deployed server, or a server rollback).
   * - "clamp" (default): serve `current` and advertise it via
   *   `x-api-version-served` / `x-api-version-requested` response headers.
   * - "reject": throw FutureVersionError (code VERSION_AHEAD); adapters map
   *   it to HTTP 400 so the mismatch is explicit instead of silent.
   */
  onFutureVersion?: "clamp" | "reject";
}

export interface SunsetOptions {
  after: string;
  message?: string;
}

export interface SunsetEntry {
  version: string;
  after: string;
  message?: string;
}

export interface SunsetCheck {
  headers: Record<string, string>;
  gone: {
    status: 410;
    body: {
      error: "api_version_sunset";
      /** Stable machine-readable code; mirrors the x-versionless-error header. */
      code: "VERSION_SUNSET";
      version: string;
      sunset: string;
      message?: string;
    };
  } | null;
}

// ---------------------------------------------------------------------------
// Exchange (the adapter contract)

export interface ExchangeInput {
  method: string;
  /** Raw pathname (used for rewrite matching and fallback route matching). */
  path: string;
  /** The framework's matched route pattern, when it has one. */
  matchedRoute?: string | null;
  /** tRPC procedure path; mutually exclusive with method/path routing. */
  procedure?: string;
  getHeader(name: string): string | null;
  /** Adapter name recorded in telemetry ("elysia", "hono", ...). */
  adapter?: string;
  /** Threaded into TransformCtx.ctx. */
  appCtx?: unknown;
}

export interface Exchange {
  version: string;
  requestedVersion?: string;
  consumerKey?: string;
  /** Canonical route key, or null when no changes touch this route (identity). */
  routeKey: string | null;
  /** When set, the adapter must re-dispatch the request to this target. */
  rewrite: { method: string; path: string } | null;
  /** Stream opt-out: skip all body work. */
  passthrough: boolean;
  transformCount: number;
  /**
   * The full response-header contract, merged into one bag the adapter sets
   * on every response: always `x-api-version-served`; plus
   * `x-api-version-requested` when the request was clamped (requested version
   * ahead of `current`); plus RFC 9745 `Deprecation` / RFC 8594 `Sunset` for
   * requests pinned to a sunsetting version.
   */
  responseHeaders: Record<string, string>;
  /** When set, the adapter returns this 410 immediately. */
  gone: SunsetCheck["gone"];
  up(body: unknown): unknown | Promise<unknown>;
  down(body: unknown): unknown | Promise<unknown>;
  downError(body: unknown): unknown | Promise<unknown>;
  /**
   * Ends tracing and, by default, emits the telemetry event for this request.
   * Latency is measured by the exchange itself (performance.now() from open to
   * finish, rounded); pass `latencyMs` only to override the measurement.
   * Adapter helpers that open an auxiliary exchange solely to compute response
   * metadata or transform an error must set `emitTelemetry: false`.
   * In serverless (immediate) mode finish() also self-flushes batched sinks;
   * `waitUntil` hands that flush promise to the platform (e.g. Workers'
   * `executionCtx.waitUntil`) so it outlives the response.
   */
  finish(opts: {
    status: number;
    latencyMs?: number;
    emitTelemetry?: boolean;
    waitUntil?: (flushed: Promise<void>) => void;
  }): void;
  /**
   * Drains batched sinks. finish() already self-flushes in serverless
   * (immediate) mode; call this only for manual/out-of-band draining.
   */
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Instance

export interface Versionless<C extends VersionlessConfig = VersionlessConfig> {
  readonly current: C["current"];
  readonly scheme: VersionScheme;
  change<const V extends string, const S extends ChangeSpec>(
    version: V,
    spec: S,
  ): Change<V, S>;
  jump(spec: JumpSpec): Jump;
  sunset(version: string, opts: SunsetOptions): void;
  register<const Cs extends readonly Change[]>(changes: Cs): VersionedApi<C, Cs>;
  openExchange(input: ExchangeInput): Exchange | Promise<Exchange>;
  /**
   * The registered rewrites' OLD routes (method + path pattern, e.g.
   * `{ method: "GET", path: "/orgs/:id" }`) — adapters register alias routes
   * for these so old-pinned clients keep resolving.
   */
  rewrites(): { method: string; path: string }[];
  telemetry: {
    use(sink: TelemetrySink): void;
    emit(event: TelemetryEvent): void;
    flush(): Promise<void>;
  };
  /** Internal — stable within the workspace, not public API. */
  readonly _registry: unknown;
}

export interface VersionedApi<
  C extends VersionlessConfig = VersionlessConfig,
  Cs extends readonly Change[] = readonly Change[],
> extends Versionless<C> {
  /** Phantom carrier for ClientTypes. */
  readonly changes: Cs;
}
