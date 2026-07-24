import type { TelemetryEvent, TelemetrySink } from "./types";
import { telemetryEventsToOtlp } from "./otlp";

export class TelemetryHub {
  private sinks: TelemetrySink[] = [];
  private lifecycles: Array<Pick<TelemetrySink, "flush" | "close">> = [];
  private erroredSinks = new WeakSet<TelemetrySink>();

  constructor(
    private sample?: (event: TelemetryEvent) => boolean,
    private onSinkError: (err: unknown) => void = () => {},
  ) {}

  use(sink: TelemetrySink): void {
    this.sinks.push(sink);
  }

  useLifecycle(lifecycle: Pick<TelemetrySink, "flush" | "close">): void {
    this.lifecycles.push(lifecycle);
  }

  get hasSinks(): boolean {
    return this.sinks.length > 0;
  }

  emit(event: TelemetryEvent): void {
    if (this.sinks.length === 0) return;
    if (this.sample && !this.sample(event)) return;
    // Off the request path: sink work happens in a microtask, and a throwing
    // sink can never fail a request.
    queueMicrotask(() => {
      for (const sink of this.sinks) {
        try {
          sink.record(event);
        } catch (err) {
          if (!this.erroredSinks.has(sink)) {
            this.erroredSinks.add(sink);
            this.onSinkError(err);
          }
        }
      }
    });
  }

  async flush(): Promise<void> {
    await Promise.allSettled([
      ...this.sinks.map((sink) => sink.flush?.()),
      ...this.lifecycles.map((lifecycle) => lifecycle.flush?.()),
    ]);
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      ...this.sinks.map((sink) => sink.close?.()),
      ...this.lifecycles.map((lifecycle) => lifecycle.close?.()),
    ]);
  }
}

/**
 * Deterministic sampling predicate for `VersionlessConfig.sample`: cheap
 * modulo sampling on the event timestamp. `rate >= 1` keeps every event.
 *
 * ```ts
 * createVersionless({ ..., sample: rateSample(0.25) })
 * ```
 */
export function rateSample(rate: number): (event: TelemetryEvent) => boolean {
  if (rate >= 1) return () => true;
  return (event) => (event.ts % 1000) / 1000 < rate;
}

// ---------------------------------------------------------------------------
// Console sink — immediate, zero deps. Attach manually in dev.

export function consoleSink(
  log: (line: string) => void = console.log,
): TelemetrySink {
  return {
    record(event) {
      const drift =
        event.requestedVersion && event.requestedVersion !== event.version
          ? ` (requested ${event.requestedVersion})`
          : "";
      log(
        `[versionless] ${event.method} ${event.route} v=${event.version}${drift} ` +
          `key=${event.consumerKey ?? "-"} transforms=${event.transformCount} ` +
          `status=${event.status} ${event.latencyMs}ms`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Batched HTTP poster — the shared engine behind the request-log sink and
// the trace sink: buffering, ring-buffer overflow, unref'd flush timer, and
// a circuit breaker. Zero deps, fetch-based.

export interface BatchedPosterOptions<T> {
  url: string;
  apiKey: string;
  /** Additional OTLP transport metadata (for example project routing). */
  headers?: Record<string, string>;
  /** Builds the POST body from a drained batch. */
  body: (items: T[]) => unknown;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  maxBuffered?: number;
  /** Serverless mode: skip the interval timer; callers drain via flush(). */
  immediate?: boolean;
  fetchImpl?: typeof fetch;
  onError?: (err: unknown) => void;
}

export interface BatchedPoster<T> {
  push(item: T): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

interface TimerLike {
  unref?(): void;
}

export function batchedPoster<T>(options: BatchedPosterOptions<T>): BatchedPoster<T> {
  const {
    url,
    apiKey,
    body,
    maxBatchSize = 500,
    flushIntervalMs = 5000,
    maxBuffered = 10_000,
    immediate = false,
    fetchImpl = fetch,
    onError = () => {},
  } = options;

  let buffer: T[] = [];
  let timer: (ReturnType<typeof setInterval> & TimerLike) | null = null;
  let inFlight: Promise<void> | null = null;
  let consecutiveFailures = 0;
  let breakerOpenUntil = 0;

  async function send(items: T[]): Promise<void> {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...options.headers,
      },
      body: JSON.stringify(body(items)),
    });
    if (!res.ok) throw new Error(`ingest responded ${res.status}`);
  }

  async function drain(): Promise<void> {
    if (buffer.length === 0) return;
    if (Date.now() < breakerOpenUntil) return;
    const batch = buffer.splice(0, maxBatchSize);
    try {
      await send(batch);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      // Re-buffer, oldest items dropped first when over capacity.
      buffer = [...batch, ...buffer].slice(-maxBuffered);
      if (immediate) {
        // A serverless instance may process only one request, so report its
        // first failed export instead of waiting for a third invocation.
        onError(err);
      } else if (consecutiveFailures === 3) {
        breakerOpenUntil = Date.now() + 30_000;
        consecutiveFailures = 0;
        onError(err);
      }
    }
  }

  function scheduleTimer(): void {
    if (immediate || timer) return;
    timer = setInterval(() => {
      inFlight = drain().finally(() => {
        inFlight = null;
      });
    }, flushIntervalMs) as ReturnType<typeof setInterval> & TimerLike;
    // Never keep the process alive just for telemetry.
    timer.unref?.();
  }

  return {
    push(item) {
      if (buffer.length >= maxBuffered) buffer.shift();
      buffer.push(item);
      scheduleTimer();
    },
    async flush() {
      if (inFlight) await inFlight;
      while (buffer.length > 0 && Date.now() >= breakerOpenUntil) {
        const before = buffer.length;
        await drain();
        if (buffer.length >= before) break; // breaker opened or send failed
      }
    },
    async close() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await this.flush();
    },
  };
}

// ---------------------------------------------------------------------------
// OTLP/HTTP JSON logs sink — batched and zero-dependency. Request analytics
// are OpenTelemetry LogRecords (eventName=versionless.request), not a custom
// top-level event envelope.

export interface HttpOtlpLogsSinkOptions {
  url: string;
  apiKey: string;
  project: string;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  maxBuffered?: number;
  /** Serverless mode: skip the interval timer; callers drain via flush(). */
  immediate?: boolean;
  fetchImpl?: typeof fetch;
  onError?: (err: unknown) => void;
}

export function httpOtlpLogsSink(
  options: HttpOtlpLogsSinkOptions,
): TelemetrySink {
  const poster = batchedPoster<TelemetryEvent>({
    ...options,
    headers: { "x-versionless-project": options.project },
    body: (events) => telemetryEventsToOtlp(options.project, events),
  });
  return {
    record: (event) => poster.push(event),
    flush: () => poster.flush(),
    close: () => poster.close(),
  };
}
