import { describe, expect, test } from "bun:test";
import { createVersionless } from "../src/index";
import type {
  Exchange,
  ExchangeInput,
  SpanAttributes,
  Tracing,
  TracingSpan,
} from "../src/types";

const CURRENT = "2026-07-21";

interface FakeSpan {
  name: string;
  attrs: SpanAttributes;
  parent: FakeSpan | null;
  exceptions: unknown[];
  ended: boolean;
}

/** Captures the span tree core emits, including explicit parent handles. */
function fakeTracing() {
  const spans: FakeSpan[] = [];
  const handles = new WeakMap<TracingSpan, FakeSpan>();

  function makeHandle(rec: FakeSpan): TracingSpan {
    const handle: TracingSpan = {
      setAttributes: (attrs) => Object.assign(rec.attrs, attrs),
      recordException: (err) => rec.exceptions.push(err),
      end: () => {
        rec.ended = true;
      },
    };
    handles.set(handle, rec);
    return handle;
  }

  const tracing: Tracing = {
    startSpan(name, attrs) {
      const rec: FakeSpan = {
        name,
        attrs: { ...attrs },
        parent: null,
        exceptions: [],
        ended: false,
      };
      spans.push(rec);
      return makeHandle(rec);
    },
    withSpan(name, attrs, parent, fn) {
      const rec: FakeSpan = {
        name,
        attrs: { ...attrs },
        parent: parent ? (handles.get(parent) ?? null) : null,
        exceptions: [],
        ended: false,
      };
      spans.push(rec);
      const handle = makeHandle(rec);
      const settle = (err?: unknown) => {
        if (err !== undefined) rec.exceptions.push(err);
        rec.ended = true;
      };
      let result: ReturnType<typeof fn>;
      try {
        result = fn(handle);
      } catch (err) {
        settle(err);
        throw err;
      }
      if (result instanceof Promise) {
        return result.then(
          (v) => {
            settle();
            return v;
          },
          (err) => {
            settle(err);
            throw err;
          },
        ) as typeof result;
      }
      settle();
      return result;
    },
  };

  return { tracing, spans };
}

function makeApi(tracing: Tracing, opts?: { asyncTransform?: boolean; resolvePin?: string }) {
  const v = createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: opts?.resolvePin
      ? [{ apiKey: async () => opts.resolvePin! }, { default: "current" }]
      : [{ header: "x-api-version" }, { default: "current" }],
    clock: () => new Date("2026-01-01T00:00:00Z"),
    tracing,
  });

  v.change("2025-09-01", {
    describe: "contact split",
    routes: ["GET /users/:id"],
    response: {
      down: opts?.asyncTransform
        ? async ({ email, ...rest }: any) => ({ ...rest, contact: { email } })
        : ({ email, ...rest }: any) => ({ ...rest, contact: { email } }),
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

describe("exchange tracing", () => {
  test("spans every step: root, resolve, per-change transforms, finish", async () => {
    const { tracing, spans } = fakeTracing();
    const v = makeApi(tracing);
    const ex = (await v.openExchange(
      input({ "x-api-version": "2025-01-01" }),
    )) as Exchange;

    const root = spans.find((s) => s.name === "versionless.exchange")!;
    expect(root.attrs["versionless.adapter"]).toBe("test");
    expect(root.attrs["versionless.method"]).toBe("GET");
    expect(root.attrs["versionless.version"]).toBe("2025-01-01");
    expect(root.attrs["versionless.route"]).toBe("GET /users/:*");
    expect(root.attrs["versionless.transform_count"]).toBe(2);
    expect(root.ended).toBe(false); // still open until finish()

    const resolve = spans.find((s) => s.name === "versionless.resolve")!;
    expect(resolve.parent).toBe(root);
    expect(resolve.attrs["versionless.version.source"]).toBe("header");
    expect(resolve.ended).toBe(true);

    await ex.down({ id: "u_42", firstName: "Ada", lastName: "L", email: "a@b.c" });
    // Downs run newest-change-first.
    const downs = spans.filter((s) => s.name === "versionless.transform.down");
    expect(downs.map((s) => s.attrs["versionless.change"])).toEqual([
      "2026-05-14",
      "2025-09-01",
    ]);
    for (const d of downs) {
      expect(d.parent).toBe(root);
      expect(d.ended).toBe(true);
    }

    ex.finish({ latencyMs: 1, status: 200 });
    expect(root.attrs["versionless.status"]).toBe(200);
    expect(root.ended).toBe(true);
  });

  test("async resolver and async transforms still span and end", async () => {
    const { tracing, spans } = fakeTracing();
    const v = makeApi(tracing, { asyncTransform: true, resolvePin: "2025-01-01" });
    const ex = (await v.openExchange(input({ "x-api-key": "key_1" }))) as Exchange;

    const resolve = spans.find((s) => s.name === "versionless.resolve")!;
    expect(resolve.attrs["versionless.version.source"]).toBe("apiKey");
    expect(resolve.ended).toBe(true);

    const out = await ex.down({ firstName: "Ada", lastName: "L", email: "a@b.c" });
    expect(out).toEqual({ name: "Ada L", contact: { email: "a@b.c" } });
    const downs = spans.filter((s) => s.name === "versionless.transform.down");
    expect(downs).toHaveLength(2);
    expect(downs.every((s) => s.ended)).toBe(true);
  });

  test("throwing transform records the TransformError on its span and rethrows", async () => {
    const { tracing, spans } = fakeTracing();
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ header: "x-api-version" }, { default: "current" }],
      tracing,
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

    // Sync chain: the TransformError surfaces synchronously.
    expect(() => ex.down({})).toThrow();
    const span = spans.find((s) => s.name === "versionless.transform.down")!;
    expect(span.ended).toBe(true);
    expect(span.exceptions).toHaveLength(1);
  });

  test("rejected future version ends the root span with the exception", async () => {
    const { tracing, spans } = fakeTracing();
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ header: "x-api-version" }, { default: "current" }],
      onFutureVersion: "reject",
      tracing,
    });
    expect(() => v.openExchange(input({ "x-api-version": "2027-01-01" }))).toThrow();
    const root = spans.find((s) => s.name === "versionless.exchange")!;
    expect(root.ended).toBe(true);
    expect(root.exceptions).toHaveLength(1);
  });

  test("no tracing configured emits no spans and changes nothing", async () => {
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ header: "x-api-version" }, { default: "current" }],
    });
    v.change("2026-05-14", {
      describe: "name split",
      routes: ["GET /users/:id"],
      response: { down: (b: any) => b },
    });
    const ex = (await v.openExchange(
      input({ "x-api-version": "2025-01-01" }),
    )) as Exchange;
    expect(await ex.down({ ok: true })).toEqual({ ok: true });
    ex.finish({ latencyMs: 1, status: 200 });
  });
});
