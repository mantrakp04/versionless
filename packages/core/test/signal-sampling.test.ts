import { describe, expect, test } from "bun:test";

import { createVersionless, DEFAULT_TRACE_SAMPLE } from "../src/index";
import type { TelemetryEvent } from "../src/types";

/**
 * Request logs and captured traces are separate signals with different default
 * sampling: logs are unsampled, successful traces head-sample at
 * DEFAULT_TRACE_SAMPLE, and failed traces are always promoted.
 *
 * Aggregate counts still come from request logs because trace capture can be
 * filtered or disabled. These tests pin the signal boundary and the failed
 * trace guarantee at the source.
 */

interface Capture {
  /** Request-log events — one per request, unsampled. */
  events: TelemetryEvent[];
  /** Exchange root spans that survived head sampling. */
  rootSpans: Array<Record<string, unknown>>;
}

/**
 * Drive `count` failing requests through a real instance with both OTLP
 * exporters stubbed, and return what each signal actually shipped.
 */
async function runRequests(
  count: number,
  status: number,
  options: { traces?: false | { sample?: number } } = {},
): Promise<Capture> {
  const events: TelemetryEvent[] = [];
  const rootSpans: Array<Record<string, unknown>> = [];

  // The built-in OTLP sinks post through the global fetch and take no
  // injection, so intercept it for the duration of the run.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const body = JSON.parse(String(init?.body));
    if (String(input).endsWith("/v1/traces")) {
      for (const resource of body.resourceSpans ?? []) {
        for (const scope of resource.scopeSpans ?? []) {
          for (const span of scope.spans ?? []) {
            if (span.name === "versionless.exchange") rootSpans.push(span);
          }
        }
      }
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const v = createVersionless({
      scheme: "date",
      current: "2026-07-21",
      resolve: [{ default: "current" }],
      project: "sampling-fixture",
      apiKey: "vl_test_secret",
      otlpLogsUrl: "https://ingest.invalid/v1/logs",
      // Drain per request so the assertions see every batch without timers.
      serverless: true,
      ...("traces" in options ? { traces: options.traces } : {}),
    });

    // Observe request logs directly; the HTTP logs sink stays installed so both
    // signals run the same path they do in production.
    v.telemetry.use({ record: (event) => events.push(event) });

    for (let index = 0; index < count; index++) {
      const exchange = await v.openExchange({
        method: "GET",
        path: "/v1/audit-events/evt_1",
        matchedRoute: "/v1/audit-events/:id",
        adapter: "test",
        getHeader: () => null,
      });
      exchange.finish({ status, latencyMs: 12 });
    }

    // emit() fans out in a microtask; flush drains both batched posters.
    await Promise.resolve();
    await v.telemetry.flush();
  } finally {
    globalThis.fetch = realFetch;
  }

  return { events, rootSpans };
}

describe("log/trace sampling policy", () => {
  test("every request produces exactly one request-log event", async () => {
    const { events } = await runRequests(200, 500);

    expect(events).toHaveLength(200);
    expect(events.every((event) => event.status === 500)).toBe(true);
  });

  test("successful traces capture only a ~10% subset of requests", async () => {
    const total = 2_000;
    const { events, rootSpans } = await runRequests(total, 200);

    expect(events).toHaveLength(total);

    // Head sampling uses Math.random(), so assert the band rather than a value.
    // Even generously wide, it excludes the "traces are complete" reading.
    const captured = rootSpans.length;
    expect(captured).toBeGreaterThan(total * DEFAULT_TRACE_SAMPLE * 0.6);
    expect(captured).toBeLessThan(total * DEFAULT_TRACE_SAMPLE * 1.6);
    expect(captured).toBeLessThan(total / 2);
  });

  test("every failed request is trace-captured at the default sample rate", async () => {
    const total = 1_000;
    const { events, rootSpans } = await runRequests(total, 500);

    const logErrors = events.filter((event) => event.status >= 400).length;
    const traceErrors = rootSpans.length;

    expect(logErrors).toBe(total);

    expect(traceErrors).toBe(logErrors);
  });

  test("raising the trace sample to 1 makes both signals agree", async () => {
    const total = 300;
    const { events, rootSpans } = await runRequests(total, 200, {
      traces: { sample: 1 },
    });

    // Sampling is the only thing separating the two counts — nothing else in
    // the capture path drops exchanges.
    expect(events).toHaveLength(total);
    expect(rootSpans).toHaveLength(total);
  });

  test("traces: false disables capture without costing a log event", async () => {
    const { events, rootSpans } = await runRequests(50, 500, {
      traces: false,
    });

    expect(events).toHaveLength(50);
    expect(rootSpans).toHaveLength(0);
  });
});
