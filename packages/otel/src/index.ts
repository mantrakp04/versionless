import {
  context,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import type {
  SpanAttributes,
  Tracing,
  TracingSpan,
} from "@versionless/core";

const TRACER_NAME = "@versionless/otel";

export interface OtelTracingOptions {
  /** Bring your own tracer; defaults to the global provider's. */
  tracer?: Tracer;
  /** Instrumentation scope name when no tracer is given. */
  tracerName?: string;
  tracerVersion?: string;
}

class OtelSpanHandle implements TracingSpan {
  private ended = false;

  constructor(readonly span: Span) {}

  setAttributes(attrs: SpanAttributes): void {
    this.span.setAttributes(attrs);
  }

  recordException(err: unknown): void {
    this.span.recordException(err instanceof Error ? err : String(err));
    this.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.span.end();
  }
}

function parentContext(parent: TracingSpan | null): Context {
  const active = context.active();
  return parent instanceof OtelSpanHandle
    ? trace.setSpan(active, parent.span)
    : active;
}

/**
 * Bridges versionless's zero-dep `Tracing` interface to OpenTelemetry, the
 * same way Prisma's instrumentation exposes engine internals as spans:
 *
 * ```ts
 * const v = createVersionless({ ..., tracing: otelTracing() });
 * ```
 *
 * Every request produces a `versionless.exchange` root span — parented under
 * the framework's active HTTP span when an OTel context manager is
 * registered — with `versionless.resolve` and one `versionless.transform.*`
 * child per registered change that runs. Transform spans are set as the
 * active context while the transform executes, so spans created inside user
 * transform code (an instrumented fetch, a DB call) nest under them.
 */
export function otelTracing(options: OtelTracingOptions = {}): Tracing {
  const tracer =
    options.tracer ??
    trace.getTracer(options.tracerName ?? TRACER_NAME, options.tracerVersion);

  return {
    startSpan(name, attrs) {
      return new OtelSpanHandle(
        tracer.startSpan(name, { attributes: attrs }, context.active()),
      );
    },

    withSpan(name, attrs, parent, fn) {
      return tracer.startActiveSpan(
        name,
        { attributes: attrs },
        parentContext(parent),
        (span) => {
          const handle = new OtelSpanHandle(span);
          let result: ReturnType<typeof fn>;
          try {
            result = fn(handle);
          } catch (err) {
            handle.recordException(err);
            handle.end();
            throw err;
          }
          if (result instanceof Promise) {
            return result.then(
              (value) => {
                handle.end();
                return value;
              },
              (err) => {
                handle.recordException(err);
                handle.end();
                throw err;
              },
            ) as typeof result;
          }
          handle.end();
          return result;
        },
      );
    },
  };
}
