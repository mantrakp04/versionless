import { batchedPoster } from "./telemetry";
import { capturedTracesToOtlp } from "./otlp";
import type { SpanAttributes, Tracing, TracingSpan } from "./types";

// ---------------------------------------------------------------------------
// Cloud trace capture. A `Tracing` backend that records ONLY the spans core
// itself creates (exchange, resolve, transforms) — never user spans, headers,
// or bodies. Successful exchanges are head-sampled; failed exchanges are
// always promoted after their final status is known. Independent of both the
// user's `tracing` backend (composed via fanoutTracing) and the telemetry
// `sample` hook.

export interface CapturedSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  attrs: SpanAttributes;
  /** Unix millis at span start. */
  startMs: number;
  durationMs: number;
  /** Whether this span completed with an error status. */
  failed?: boolean;
}

export interface CapturedTrace {
  traceId: string;
  spans: CapturedSpan[];
}

export interface TraceSink {
  record(trace: CapturedTrace): void;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

const ROOT_SPAN = "versionless.exchange";
/** Backstop against exchanges whose finish() never runs. */
const MAX_SPANS_PER_TRACE = 128;

function randomTraceId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

interface TraceState {
  traceId: string;
  spans: CapturedSpan[];
  nextSpanId: bigint;
  sampled: boolean;
  hasError: boolean;
  done: boolean;
}

class CaptureSpan implements TracingSpan {
  private start: number;
  private record: CapturedSpan | null = null;

  constructor(
    readonly state: TraceState,
    private readonly sink: TraceSink,
    private readonly now: () => number,
    private readonly isRoot: boolean,
    name: string,
    attrs: SpanAttributes | undefined,
    parent?: CaptureSpan,
  ) {
    this.start = now();
    if (state.spans.length < MAX_SPANS_PER_TRACE) {
      this.record = {
        spanId: (state.nextSpanId++).toString(16).padStart(16, "0"),
        ...(parent?.record ? { parentSpanId: parent.record.spanId } : {}),
        name,
        attrs: { ...attrs },
        startMs: this.start,
        durationMs: 0,
      };
      state.spans.push(this.record);
    }
  }

  setAttributes(attrs: SpanAttributes): void {
    if (this.record) Object.assign(this.record.attrs, attrs);
  }

  recordException(_err: unknown): void {
    if (this.record) {
      // Exception messages may contain payload, database, service, or secret
      // details. Capture only the safe status flag; diagnostics stay in the
      // application's own tracing/logging backend.
      this.record.failed = true;
      this.state.hasError = true;
    }
  }

  end(): void {
    if (this.record) {
      this.record.durationMs = Math.max(0, this.now() - this.start);
    }
    if (this.isRoot && !this.state.done) {
      this.state.done = true;
      const status = Number(this.record?.attrs["versionless.status"]);
      if (this.record && status >= 400) this.record.failed = true;
      if (this.state.sampled || this.state.hasError || status >= 400) {
        this.sink.record({ traceId: this.state.traceId, spans: this.state.spans });
      }
    }
  }
}

/** Inert handle for filtered exchanges: satisfies the interface, records nothing. */
const INERT_SPAN: TracingSpan = {
  setAttributes() {},
  recordException() {},
  end() {},
};

export interface CaptureTracingOptions {
  /** Successful-exchange sampling rate in [0, 1]. Failures are always kept. */
  sample: number;
  sink: TraceSink;
  /** Pre-sampling veto on the exchange root's attributes. */
  filter?: (rootAttrs: SpanAttributes) => boolean;
  now?: () => number;
  rand?: () => number;
}

export function createCaptureTracing(options: CaptureTracingOptions): Tracing {
  const { sample, sink, filter, now = Date.now, rand = Math.random } = options;

  return {
    startSpan(name, attrs) {
      // Buffer every eligible exchange so a failed response can be promoted
      // after its final status is known. Successful exchanges still obey the
      // root head-sampling decision, and every kept trace remains complete.
      if (name !== ROOT_SPAN) return INERT_SPAN;
      if (filter && !filter(attrs ?? {})) return INERT_SPAN;
      const state: TraceState = {
        traceId: randomTraceId(),
        spans: [],
        nextSpanId: 1n,
        sampled: rand() < sample,
        hasError: false,
        done: false,
      };
      return new CaptureSpan(state, sink, now, true, name, attrs);
    },

    withSpan(name, attrs, parent, fn) {
      if (!(parent instanceof CaptureSpan)) return fn(INERT_SPAN);
      const span = new CaptureSpan(
        parent.state,
        sink,
        now,
        false,
        name,
        attrs,
        parent,
      );
      let result: ReturnType<typeof fn>;
      try {
        result = fn(span);
      } catch (err) {
        span.recordException(err);
        span.end();
        throw err;
      }
      if (result instanceof Promise) {
        return result.then(
          (value) => {
            span.end();
            return value;
          },
          (err) => {
            span.recordException(err);
            span.end();
            throw err;
          },
        ) as typeof result;
      }
      span.end();
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Fan-out: compose the user's tracing backend (e.g. otelTracing()) with cloud
// capture. The LAST backend's withSpan wraps fn outermost, so list the
// context-propagating backend first and capture second — capture only does
// bookkeeping and never touches active context.

class FanoutSpan implements TracingSpan {
  constructor(readonly parts: TracingSpan[]) {}
  setAttributes(attrs: SpanAttributes): void {
    for (const s of this.parts) s.setAttributes(attrs);
  }
  recordException(err: unknown): void {
    for (const s of this.parts) s.recordException(err);
  }
  end(): void {
    for (const s of this.parts) s.end();
  }
}

export function fanoutTracing(backends: Tracing[]): Tracing {
  return {
    startSpan(name, attrs) {
      return new FanoutSpan(backends.map((t) => t.startSpan(name, attrs)));
    },
    withSpan(name, attrs, parent, fn) {
      const parents =
        parent instanceof FanoutSpan
          ? parent.parts
          : backends.map(() => parent);
      const run = (
        i: number,
        spans: TracingSpan[],
      ): ReturnType<typeof fn> => {
        if (i === backends.length) return fn(new FanoutSpan(spans));
        return backends[i]!.withSpan(name, attrs, parents[i] ?? null, (span) =>
          run(i + 1, [...spans, span]),
        );
      };
      return run(0, []);
    },
  };
}

// ---------------------------------------------------------------------------
// OTLP/HTTP JSON trace sink — ships standard ExportTraceServiceRequest
// envelopes with the same batching/breaker behavior as the logs sink.

export interface HttpOtlpTraceSinkOptions {
  url: string;
  apiKey: string;
  project: string;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  maxBuffered?: number;
  immediate?: boolean;
  fetchImpl?: typeof fetch;
  onError?: (err: unknown) => void;
}

export function httpOtlpTraceSink(
  options: HttpOtlpTraceSinkOptions,
): TraceSink {
  const poster = batchedPoster<CapturedTrace>({
    ...options,
    headers: { "x-versionless-project": options.project },
    maxBatchSize: options.maxBatchSize ?? 100,
    maxBuffered: options.maxBuffered ?? 1000,
    body: (traces) => capturedTracesToOtlp(options.project, traces),
  });
  return {
    record: (trace) => poster.push(trace),
    flush: () => poster.flush(),
    close: () => poster.close(),
  };
}
