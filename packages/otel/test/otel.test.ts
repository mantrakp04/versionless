import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { createVersionless, type Exchange, type ExchangeInput } from "@versionless/core";
import { otelTracing } from "../src/index";

const CURRENT = "2026-07-21";

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
let contextManager: AsyncLocalStorageContextManager;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
});

afterEach(async () => {
  context.disable();
  await provider.shutdown();
});

function makeApi(opts?: { down?: (body: any) => any | Promise<any> }) {
  const v = createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    tracing: otelTracing({ tracer: provider.getTracer("test") }),
  });
  v.change("2025-09-01", {
    describe: "contact split",
    routes: ["GET /users/:id"],
    response: {
      down:
        opts?.down ??
        (({ email, ...rest }: any) => ({ ...rest, contact: { email } })),
    },
  });
  v.change("2026-05-14", {
    describe: "name split",
    routes: ["GET /users/:id"],
    response: {
      down: ({ firstName, lastName, ...rest }: any) => ({
        ...rest,
        name: `${firstName} ${lastName}`.trim(),
      }),
    },
  });
  return v;
}

function input(headers: Record<string, string>): ExchangeInput {
  return {
    method: "GET",
    path: "/users/u_42",
    matchedRoute: "/users/:id",
    adapter: "test",
    getHeader: (name) => headers[name.toLowerCase()] ?? null,
  };
}

function spanId(s: ReadableSpan): string {
  return s.spanContext().spanId;
}

function parentId(s: ReadableSpan): string | undefined {
  return (
    (s as { parentSpanContext?: { spanId: string } }).parentSpanContext?.spanId ??
    (s as unknown as { parentSpanId?: string }).parentSpanId
  );
}

describe("otelTracing", () => {
  test("exchange spans nest under the active HTTP span with full hierarchy", async () => {
    const v = makeApi();
    const tracer = provider.getTracer("test");

    await tracer.startActiveSpan("http.request", async (httpSpan) => {
      const ex = (await v.openExchange(
        input({ "x-api-version": "2025-01-01" }),
      )) as Exchange;
      await ex.down({ firstName: "Ada", lastName: "L", email: "a@b.c" });
      ex.finish({ latencyMs: 1, status: 200 });
      httpSpan.end();
    });

    const spans = exporter.getFinishedSpans();
    const http = spans.find((s) => s.name === "http.request")!;
    const root = spans.find((s) => s.name === "versionless.exchange")!;
    const resolve = spans.find((s) => s.name === "versionless.resolve")!;
    const downs = spans.filter((s) => s.name === "versionless.transform.down");

    // Propagation: framework span -> exchange -> resolve/transforms.
    expect(parentId(root)).toBe(spanId(http));
    expect(parentId(resolve)).toBe(spanId(root));
    expect(downs).toHaveLength(2);
    for (const d of downs) expect(parentId(d)).toBe(spanId(root));

    expect(root.attributes["versionless.version"]).toBe("2025-01-01");
    expect(root.attributes["versionless.transform_count"]).toBe(2);
    expect(root.attributes["versionless.status"]).toBe(200);
    expect(downs.map((d) => d.attributes["versionless.change"])).toEqual([
      "2026-05-14",
      "2025-09-01",
    ]);
    // All spans share one trace.
    const traceId = http.spanContext().traceId;
    for (const s of spans) expect(s.spanContext().traceId).toBe(traceId);
  });

  test("user spans created inside a transform nest under the transform span", async () => {
    const tracer = provider.getTracer("test");
    const v = makeApi({
      down: (body: any) => {
        // Simulates instrumented user code (fetch, DB) inside a transform.
        const inner = tracer.startSpan("user.lookup");
        inner.end();
        return body;
      },
    });
    const ex = (await v.openExchange(
      input({ "x-api-version": "2025-01-01" }),
    )) as Exchange;
    await ex.down({ firstName: "Ada", lastName: "L", email: "a@b.c" });
    ex.finish({ latencyMs: 1, status: 200 });

    const spans = exporter.getFinishedSpans();
    const transform = spans.find(
      (s) =>
        s.name === "versionless.transform.down" &&
        s.attributes["versionless.change"] === "2025-09-01",
    )!;
    const user = spans.find((s) => s.name === "user.lookup")!;
    expect(parentId(user)).toBe(spanId(transform));
  });

  test("async transform failure marks the span as error and rethrows", async () => {
    const v = makeApi({
      down: async () => {
        throw new Error("kaboom");
      },
    });
    const ex = (await v.openExchange(
      input({ "x-api-version": "2025-01-01" }),
    )) as Exchange;

    await expect(ex.down({ firstName: "A", lastName: "B" })).rejects.toThrow();
    const failed = exporter
      .getFinishedSpans()
      .find(
        (s) =>
          s.name === "versionless.transform.down" &&
          s.status.code === SpanStatusCode.ERROR,
      );
    expect(failed).toBeDefined();
    expect(failed!.events.some((e) => e.name === "exception")).toBe(true);
  });

  test("works with the global tracer provider by default", async () => {
    trace.setGlobalTracerProvider(provider);
    try {
      const v = createVersionless({
        scheme: "date",
        current: CURRENT,
        resolve: [{ default: "current" }],
        tracing: otelTracing(),
      });
      const ex = (await v.openExchange(input({}))) as Exchange;
      ex.finish({ latencyMs: 1, status: 200 });
      const names = exporter.getFinishedSpans().map((s) => s.name);
      expect(names).toContain("versionless.exchange");
    } finally {
      trace.disable();
    }
  });
});
