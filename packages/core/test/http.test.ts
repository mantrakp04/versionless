import { afterEach, describe, expect, test } from "bun:test";
import { FutureVersionError, VersionResolutionError } from "../src/errors";
import {
  buildRewriteRequest,
  HEADERS,
  isTransformableJson,
  runFetchExchange,
  runRewriteExchange,
  toWireError,
  withResponseHeaders,
} from "../src/http";
import { createVersionless } from "../src/index";
import { rateSample } from "../src/telemetry";
import type { TelemetryEvent } from "../src/types";

const CURRENT = "2026-07-21";

function makeApi(onFutureVersion?: "clamp" | "reject") {
  const v = createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    clock: () => new Date("2026-01-15T00:00:00Z"),
    ...(onFutureVersion ? { onFutureVersion } : {}),
  });
  v.change("2026-05-14", {
    describe: "split name into firstName/lastName",
    routes: ["GET /users/:id", "POST /users"],
    request: {
      up: ({ name, ...rest }: any) => {
        const [firstName, ...restName] = String(name).split(" ");
        return { ...rest, firstName, lastName: restName.join(" ") };
      },
    },
    response: {
      down: ({ firstName, lastName, ...rest }: any) => ({
        ...rest,
        name: [firstName, lastName].filter(Boolean).join(" "),
      }),
    },
  });
  v.change("2025-06-01", {
    describe: "orgs renamed to teams",
    rewrite: { from: "GET /orgs/:id", to: "GET /teams/:id" },
  });
  v.sunset("2025-01-01", { after: "2026-01-31" });
  return v;
}

describe("isTransformableJson", () => {
  test("requires a JSON content type", () => {
    expect(isTransformableJson("application/json", null)).toBe(true);
    expect(isTransformableJson("Application/JSON; charset=utf-8", null)).toBe(true);
    expect(isTransformableJson("text/plain", null)).toBe(false);
    expect(isTransformableJson(null, null)).toBe(false);
    expect(isTransformableJson(undefined, "10")).toBe(false);
  });

  test("rejects declared lengths above the cap; admits undeclared lengths", () => {
    expect(isTransformableJson("application/json", String(1024 * 1024))).toBe(true);
    expect(isTransformableJson("application/json", String(1024 * 1024 + 1))).toBe(false);
    expect(isTransformableJson("application/json", "10", 5)).toBe(false);
    expect(isTransformableJson("application/json", null)).toBe(true);
  });
});

describe("toWireError", () => {
  test("maps VersionResolutionError to the invalid_api_version wire shape", () => {
    const wire = toWireError(new VersionResolutionError("not-a-date", "date"))!;
    expect(wire.status).toBe(400);
    expect(wire.headers).toEqual({ [HEADERS.error]: "VERSION_INVALID" });
    expect(wire.body.error).toBe("invalid_api_version");
    expect(wire.body.code).toBe("VERSION_INVALID");
    expect(wire.body.message).toContain("not-a-date");
  });

  test("maps FutureVersionError to the api_version_ahead wire shape", () => {
    const wire = toWireError(new FutureVersionError("2027-01-01", CURRENT))!;
    expect(wire.status).toBe(400);
    expect(wire.headers).toEqual({
      [HEADERS.error]: "VERSION_AHEAD",
      [HEADERS.served]: CURRENT,
    });
    expect(wire.body).toMatchObject({
      error: "api_version_ahead",
      code: "VERSION_AHEAD",
      requested: "2027-01-01",
      current: CURRENT,
    });
  });

  test("returns null for anything else", () => {
    expect(toWireError(new Error("boom"))).toBeNull();
    expect(toWireError("nope")).toBeNull();
  });
});

describe("buildRewriteRequest", () => {
  test("null rewrite means 404 (no request to build)", () => {
    expect(buildRewriteRequest(new Request("http://x/orgs/7"), null)).toBeNull();
  });

  test("swaps the pathname, preserving query and headers", () => {
    const req = buildRewriteRequest(
      new Request("http://x/orgs/7?expand=1", { headers: { "x-api-version": "2025-01-01" } }),
      { method: "GET", path: "/teams/7" },
    )!;
    const url = new URL(req.url);
    expect(url.pathname).toBe("/teams/7");
    expect(url.search).toBe("?expand=1");
    expect(req.headers.get("x-api-version")).toBe("2025-01-01");
    expect(req.method).toBe("GET");
  });

  test("swaps the method when the rewrite changes it", () => {
    const req = buildRewriteRequest(new Request("http://x/orgs/7"), {
      method: "POST",
      path: "/teams/7",
    })!;
    expect(req.method).toBe("POST");
  });
});

describe("withResponseHeaders", () => {
  test("applies the merged bag, rebuilding immutable-header responses", async () => {
    const v = makeApi();
    const ex = await v.openExchange({
      method: "GET",
      path: "/users/1",
      matchedRoute: "/users/:id",
      getHeader: (name) => (name === "x-api-version" ? "2025-01-01" : null),
      adapter: "test",
    });
    const mutable = withResponseHeaders(Response.json({ ok: true }), ex);
    expect(mutable.headers.get(HEADERS.served)).toBe("2025-01-01");
    expect(mutable.headers.get("sunset")).toContain("2026");
    expect(mutable.headers.get("deprecation")).toMatch(/^@\d+$/);

    // `Response.error()` has immutable headers — forces the rebuild path.
    const immutable = withResponseHeaders(Response.error(), ex);
    expect(immutable.headers.get(HEADERS.served)).toBe("2025-01-01");
    ex.finish({ status: 200, emitTelemetry: false });
  });
});

describe("runFetchExchange", () => {
  test("round-trips old-shape bodies and applies the response headers", async () => {
    const v = makeApi();
    const events: TelemetryEvent[] = [];
    v.telemetry.use({ record: (e) => events.push(e) });
    let seen: unknown;
    const res = await runFetchExchange(
      v,
      new Request("http://x/users", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-version": "2025-01-01" },
        body: JSON.stringify({ name: "Grace Hopper" }),
      }),
      async (req) => {
        seen = await req.json();
        return Response.json(seen);
      },
      { adapter: "test", matchedRoute: "/users" },
    );
    expect(seen).toEqual({ firstName: "Grace", lastName: "Hopper" });
    expect(await res.json()).toEqual({ name: "Grace Hopper" });
    expect(res.headers.get(HEADERS.served)).toBe("2025-01-01");
    await Bun.sleep(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: "POST /users", status: 200, adapter: "test" });
    // Latency is measured by the exchange itself now.
    expect(events[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("maps resolution errors to the wire shape", async () => {
    const v = makeApi();
    const res = await runFetchExchange(
      v,
      new Request("http://x/users/1", { headers: { "x-api-version": "not-a-date" } }),
      async () => Response.json({}),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get(HEADERS.error)).toBe("VERSION_INVALID");
    expect(await res.json()).toMatchObject({ error: "invalid_api_version", code: "VERSION_INVALID" });
  });

  test("maps FutureVersionError under the reject policy", async () => {
    const v = makeApi("reject");
    const res = await runFetchExchange(
      v,
      new Request("http://x/users/1", { headers: { "x-api-version": "2027-01-01" } }),
      async () => Response.json({}),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get(HEADERS.error)).toBe("VERSION_AHEAD");
    expect(res.headers.get(HEADERS.served)).toBe(CURRENT);
    expect(await res.json()).toMatchObject({
      error: "api_version_ahead",
      requested: "2027-01-01",
      current: CURRENT,
    });
  });

  test("sunset-gone short-circuits with the 410 body and error header", async () => {
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ header: "x-api-version" }, { default: "current" }],
      clock: () => new Date("2026-03-01T00:00:00Z"),
    });
    v.sunset("2025-01-01", { after: "2026-01-31" });
    const res = await runFetchExchange(
      v,
      new Request("http://x/users/1", { headers: { "x-api-version": "2025-01-01" } }),
      async () => Response.json({}),
    );
    expect(res.status).toBe(410);
    expect(res.headers.get(HEADERS.error)).toBe("VERSION_SUNSET");
    expect(res.headers.get("sunset")).toBeTruthy();
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("api_version_sunset");
  });
});

describe("runRewriteExchange", () => {
  test("forwards old pins to the rewrite target and 404s current pins", async () => {
    const v = makeApi();
    const forward = (req: Request) =>
      Response.json({ forwardedTo: new URL(req.url).pathname });
    const old = await runRewriteExchange(
      v,
      new Request("http://x/orgs/7", { headers: { "x-api-version": "2025-01-01" } }),
      forward,
      { adapter: "test" },
    );
    expect(await old.json()).toEqual({ forwardedTo: "/teams/7" });

    const current = await runRewriteExchange(v, new Request("http://x/orgs/7"), forward);
    expect(current.status).toBe(404);
    expect(current.headers.get(HEADERS.served)).toBe(CURRENT);
  });
});

describe("v.rewrites()", () => {
  test("lists the rewrites' old routes with param names intact", () => {
    const v = makeApi();
    expect(v.rewrites()).toEqual([{ method: "GET", path: "/orgs/:id" }]);
  });

  test("is empty without rewrites", () => {
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ default: "current" }],
    });
    expect(v.rewrites()).toEqual([]);
  });
});

describe("rateSample", () => {
  const event = (ts: number): TelemetryEvent => ({
    ts,
    method: "GET",
    route: "GET /x",
    adapter: "test",
    version: CURRENT,
    latencyMs: 1,
    transformCount: 0,
    status: 200,
  });

  test("rate >= 1 keeps everything", () => {
    const keep = rateSample(1);
    expect(keep(event(999))).toBe(true);
    expect(rateSample(2)(event(1))).toBe(true);
  });

  test("samples deterministically on the event timestamp", () => {
    const half = rateSample(0.5);
    expect(half(event(1000))).toBe(true); // 0 / 1000 < 0.5
    expect(half(event(1499))).toBe(true); // 499 / 1000 < 0.5
    expect(half(event(1500))).toBe(false); // 500 / 1000 >= 0.5
    expect(rateSample(0)(event(1000))).toBe(false);
  });
});

describe("serverless self-flush", () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });

  test("finish() drains sinks when the instance is in immediate mode", async () => {
    process.env.VERCEL = "1";
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ default: "current" }],
    });
    const recorded: TelemetryEvent[] = [];
    let flushes = 0;
    v.telemetry.use({
      record: (e) => recorded.push(e),
      flush: async () => {
        flushes++;
      },
    });
    let handedOff: Promise<void> | undefined;
    const ex = await v.openExchange({
      method: "GET",
      path: "/x",
      getHeader: () => null,
      adapter: "test",
    });
    ex.finish({ status: 200, waitUntil: (p) => (handedOff = p) });
    expect(handedOff).toBeDefined();
    await handedOff;
    // The emit microtask fans out before the flush drains.
    expect(recorded).toHaveLength(1);
    expect(flushes).toBeGreaterThanOrEqual(1);
  });

  test("finish() does not flush outside immediate mode", async () => {
    const v = createVersionless({
      scheme: "date",
      current: CURRENT,
      resolve: [{ default: "current" }],
    });
    let flushes = 0;
    v.telemetry.use({ record: () => {}, flush: async () => { flushes++; } });
    const ex = await v.openExchange({
      method: "GET",
      path: "/x",
      getHeader: () => null,
      adapter: "test",
    });
    ex.finish({ status: 200 });
    await Bun.sleep(1);
    expect(flushes).toBe(0);
  });
});
