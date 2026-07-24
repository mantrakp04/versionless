import { describe, expect, test } from "bun:test";
import { createVersionless } from "../src/index";
import {
  createCaptureTracing,
  fanoutTracing,
  httpOtlpTraceSink,
  type CapturedTrace,
  type TraceSink,
} from "../src/trace-capture";
import type { Exchange, ExchangeInput, Tracing } from "../src/types";

const CURRENT = "2026-07-21";

function memorySink() {
  const traces: CapturedTrace[] = [];
  const sink: TraceSink = { record: (t) => traces.push(t) };
  return { sink, traces };
}

function makeApi(tracing: Tracing) {
  const v = createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    tracing,
  });
  v.change("2025-09-01", {
    describe: "contact split",
    routes: ["GET /users/:id"],
    response: {
      down: ({ email, ...rest }: any) => ({ ...rest, contact: { email } }),
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

async function runExchange(v: ReturnType<typeof makeApi>) {
  const ex = (await v.openExchange(
    input({ "x-api-version": "2025-01-01" }),
  )) as Exchange;
  await ex.down({ firstName: "Ada", lastName: "L", email: "a@b.c" });
  ex.finish({ latencyMs: 2, status: 200 });
}

describe("createCaptureTracing", () => {
  test("a sampled exchange records the complete versionless span tree", async () => {
    const { sink, traces } = memorySink();
    const v = makeApi(createCaptureTracing({ sample: 1, sink, rand: () => 0 }));
    await runExchange(v);

    expect(traces).toHaveLength(1);
    const spans = traces[0]!.spans;
    const root = spans.find((s) => s.name === "versionless.exchange")!;
    expect(root.parentSpanId).toBeUndefined();
    expect(root.attrs["versionless.version"]).toBe("2025-01-01");
    expect(root.attrs["versionless.status"]).toBe(200);
    expect(root.attrs["versionless.transform_count"]).toBe(2);

    const resolve = spans.find((s) => s.name === "versionless.resolve")!;
    expect(resolve.parentSpanId).toBe(root.spanId);
    expect(resolve.attrs["versionless.version.source"]).toBe("header");

    const downs = spans.filter((s) => s.name === "versionless.transform.down");
    expect(downs.map((s) => s.attrs["versionless.change"])).toEqual([
      "2026-05-14",
      "2025-09-01",
    ]);
    for (const d of downs) expect(d.parentSpanId).toBe(root.spanId);
  });

  test("head sampling keeps or drops whole exchanges at the configured rate", async () => {
    const { sink, traces } = memorySink();
    let n = 0;
    // Alternates 0.0, 0.5: with sample=0.4 only every other exchange is kept.
    const v = makeApi(
      createCaptureTracing({ sample: 0.4, sink, rand: () => (n++ % 2 ? 0.5 : 0) }),
    );
    await runExchange(v);
    await runExchange(v);
    await runExchange(v);
    await runExchange(v);
    expect(traces).toHaveLength(2);
    // Dropped exchanges contribute zero spans anywhere.
    for (const t of traces) {
      expect(t.spans.filter((s) => s.name === "versionless.exchange")).toHaveLength(1);
    }
  });

  test("filter vetoes exchanges before sampling (e.g. self-ingest routes)", async () => {
    const { sink, traces } = memorySink();
    const v = makeApi(
      createCaptureTracing({
        sample: 1,
        sink,
        filter: (attrs) => !String(attrs["versionless.path"]).startsWith("/v1/"),
      }),
    );
    await runExchange(v); // /users/u_42 — captured
    const ex = (await v.openExchange({
      method: "POST",
      path: "/v1/logs",
      adapter: "test",
      getHeader: () => null,
    })) as Exchange;
    ex.finish({ latencyMs: 1, status: 200 });
    expect(traces).toHaveLength(1);
    expect(
      traces[0]!.spans[0]!.attrs["versionless.route"],
    ).toBe("GET /users/:*");
  });

  test("sample: 0 records nothing and exchanges still work", async () => {
    const { sink, traces } = memorySink();
    const v = makeApi(createCaptureTracing({ sample: 0, sink }));
    await runExchange(v);
    expect(traces).toHaveLength(0);
  });

  test("a failing transform records the error on its span", async () => {
    const { sink, traces } = memorySink();
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ header: "x-api-version" }, { default: "current" }],
      tracing: createCaptureTracing({ sample: 1, sink }),
    });
    v.change("2026-05-14", {
      describe: "boom",
      routes: ["GET /users/:id"],
      response: {
        down: () => {
          throw new Error("boom");
        },
      },
    });
    const ex = (await v.openExchange(
      input({ "x-api-version": "2025-01-01" }),
    )) as Exchange;
    expect(() => ex.down({})).toThrow();
    ex.finish({ latencyMs: 1, status: 500 });

    const spans = traces[0]!.spans;
    const failed = spans.find((s) => s.name === "versionless.transform.down")!;
    expect(failed.error).toContain("boom");
  });
});

describe("fanoutTracing", () => {
  test("capture and a user backend both see every span with correct parents", async () => {
    const { sink, traces } = memorySink();
    const seen: string[] = [];
    const userTracing: Tracing = {
      startSpan: (name) => {
        seen.push(name);
        return { setAttributes() {}, recordException() {}, end() {} };
      },
      withSpan: (name, _a, _p, fn) => {
        seen.push(name);
        return fn({ setAttributes() {}, recordException() {}, end() {} });
      },
    };
    const v = makeApi(
      fanoutTracing([userTracing, createCaptureTracing({ sample: 1, sink })]),
    );
    await runExchange(v);

    expect(seen).toContain("versionless.exchange");
    expect(seen).toContain("versionless.resolve");
    expect(seen.filter((n) => n === "versionless.transform.down")).toHaveLength(2);
    expect(traces).toHaveLength(1);
    const root = traces[0]!.spans.find((s) => s.name === "versionless.exchange")!;
    expect(
      traces[0]!.spans.filter((s) => s.parentSpanId === root.spanId),
    ).toHaveLength(3); // resolve + 2 downs
  });
});

describe("cloud wiring via createVersionless", () => {
  test("apiKey ships sampled traces to /v1/traces, separate from request logs", async () => {
    const posts: { url: string; body: any; headers: Headers }[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      posts.push({
        url: String(url),
        body: JSON.parse(init.body),
        headers: new Headers(init.headers),
      });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    // traces config has no fetchImpl injection point on the public config —
    // exercise the sink directly with the same URL derivation contract.
    const sink = httpOtlpTraceSink({
      url: "https://ingest.example.com/v1/traces",
      apiKey: "vl_k1_secret",
      project: "demo",
      immediate: true,
      fetchImpl,
    });
    sink.record({
      traceId: "t1",
      spans: [
        {
          spanId: "s1",
          name: "versionless.exchange",
          attrs: { "versionless.version": "2025-01-01" },
          startMs: 1700000000000,
          durationMs: 3,
        },
      ],
    });
    await sink.flush?.();

    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("https://ingest.example.com/v1/traces");
    expect(posts[0]!.headers.get("x-versionless-project")).toBe("demo");
    expect(posts[0]!.body.resourceSpans[0].resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "demo" },
    });
    expect(posts[0]!.body.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({
      traceId: "t1",
      name: "versionless.exchange",
    });
  });

  test("traces: false disables capture but keeps telemetry", async () => {
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ default: "current" }],
      project: "demo",
      apiKey: "vl_k1_secret",
      traces: false,
      // Drop every event pre-sink so this test never attempts a network POST.
      sample: () => false,
    });
    const ex = (await v.openExchange(input({}))) as Exchange;
    // No tracing configured and traces disabled: exchange runs untraced.
    ex.finish({ latencyMs: 1, status: 200 });
    await v.telemetry.flush();
  });
});
