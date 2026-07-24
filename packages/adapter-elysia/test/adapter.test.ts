import { afterEach, describe, expect, test } from "bun:test";
import { createVersionless } from "@versionless/core";
import type { TelemetryEvent, Versionless } from "@versionless/core";
import { Elysia } from "elysia";
import {
  versionless,
  versionlessRewrites,
  type VersionlessElysiaOptions,
} from "../src/index";

const BEFORE_SUNSET = () => new Date("2026-01-01T00:00:00Z");
const AFTER_SUNSET = () => new Date("2026-07-21T00:00:00Z");

function makeInstance(
  clock: () => Date,
  onFutureVersion?: "clamp" | "reject",
): Versionless {
  const v = createVersionless({
    scheme: "date",
    current: "2026-07-21",
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    clock,
    ...(onFutureVersion ? { onFutureVersion } : {}),
  });
  v.change("2026-05-14", {
    describe: "split name into firstName/lastName",
    routes: ["GET /users/:id", "POST /users", "GET /stream"],
    request: {
      up: (body: any) => {
        const { name, ...rest } = body;
        const parts = String(name ?? "").split(" ");
        return { ...rest, firstName: parts[0], lastName: parts.slice(1).join(" ") };
      },
    },
    response: {
      down: (body: any) => {
        const { firstName, lastName, ...rest } = body;
        return { ...rest, name: [firstName, lastName].filter(Boolean).join(" ") };
      },
    },
  });
  v.change("2025-06-01", {
    describe: "orgs renamed to teams",
    rewrite: { from: "GET /orgs/:id", to: "GET /teams/:id" },
  });
  v.sunset("2025-01-01", { after: "2026-01-31" });
  return v;
}

function makeApp(v: Versionless, options?: VersionlessElysiaOptions) {
  const app = new Elysia()
    .use(versionless(v, options))
    .get("/users/:id", ({ params }) => ({ id: params.id, firstName: "Ada", lastName: "Lovelace" }))
    .post("/users", ({ body }) => body)
    .get("/teams/:id", ({ params }) => ({ team: params.id }))
    .get(
      "/stream",
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("chunk-1"));
              c.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
  return versionlessRewrites(v, app);
}

function fixture(
  clock: () => Date = BEFORE_SUNSET,
  onFutureVersion?: "clamp" | "reject",
) {
  const v = makeInstance(clock, onFutureVersion);
  return { v, app: makeApp(v) };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers });

describe("@versionless/adapter-elysia", () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });

  test("no version header serves the current shape", async () => {
    const { app } = fixture();
    const res = await app.handle(get("/users/7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-version-served")).toBe("2026-07-21");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ id: "7", firstName: "Ada", lastName: "Lovelace" });
    expect(body.name).toBeUndefined();
  });

  test("old pins are served their pinned version and told so", async () => {
    const { app } = fixture();
    const res = await app.handle(get("/users/7", { "x-api-version": "2025-01-01" }));
    expect(res.headers.get("x-api-version-served")).toBe("2025-01-01");
    expect(res.headers.get("x-api-version-requested")).toBeNull();
  });

  test("future pins clamp to current and advertise the drift", async () => {
    const { app } = fixture();
    const res = await app.handle(get("/users/7", { "x-api-version": "2027-01-01" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-version-served")).toBe("2026-07-21");
    expect(res.headers.get("x-api-version-requested")).toBe("2027-01-01");
  });

  test("reject policy maps future pins to 400 api_version_ahead", async () => {
    const { app } = fixture(BEFORE_SUNSET, "reject");
    const res = await app.handle(get("/users/7", { "x-api-version": "2027-01-01" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("x-versionless-error")).toBe("VERSION_AHEAD");
    expect(res.headers.get("x-api-version-served")).toBe("2026-07-21");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("api_version_ahead");
    expect(body.code).toBe("VERSION_AHEAD");
    expect(body.requested).toBe("2027-01-01");
    expect(body.current).toBe("2026-07-21");
  });

  test("old pin gets the down-transformed response shape", async () => {
    const { app } = fixture();
    const res = await app.handle(get("/users/7", { "x-api-version": "2025-01-01" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("Ada Lovelace");
    expect(body.firstName).toBeUndefined();
    expect(body.lastName).toBeUndefined();
    expect(body.id).toBe("7");
  });

  test("old request body is up-transformed before the handler (round trip)", async () => {
    const { app } = fixture();
    const res = await app.handle(
      new Request("http://localhost/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-version": "2025-01-01",
        },
        body: JSON.stringify({ name: "Ada Lovelace" }),
      }),
    );
    expect(res.status).toBe(200);
    // Handler echoed its body: up produced firstName/lastName (current shape),
    // then down merged back to name for the old client.
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("Ada Lovelace");
    expect(body.firstName).toBeUndefined();
    expect(body.lastName).toBeUndefined();
  });

  test("old client on a rewritten path is re-dispatched to the target route", async () => {
    const { app } = fixture();
    const res = await app.handle(get("/orgs/7", { "x-api-version": "2025-01-01" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ team: "7" });
  });

  test("sunset headers are present for pinned-old requests", async () => {
    const { app } = fixture();
    const res = await app.handle(get("/users/7", { "x-api-version": "2025-01-01" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("deprecation")).toMatch(/^@\d+$/);
    expect(res.headers.get("sunset")).toContain("2026");
  });

  test("past the sunset cutoff, pinned-old requests get 410 gone", async () => {
    const { app } = fixture(AFTER_SUNSET);
    const res = await app.handle(get("/users/7", { "x-api-version": "2025-01-01" }));
    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("api_version_sunset");
    expect(body.version).toBe("2025-01-01");
    expect(res.headers.get("sunset")).not.toBeNull();
  });

  test("invalid version header maps to 400 invalid_api_version", async () => {
    const { app } = fixture();
    const res = await app.handle(get("/users/7", { "x-api-version": "not-a-date" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("x-versionless-error")).toBe("VERSION_INVALID");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_api_version");
    expect(body.code).toBe("VERSION_INVALID");
    expect(body.message).toContain("not-a-date");
  });

  test("telemetry records one event per request with route/version/status", async () => {
    const { v, app } = fixture();
    const events: TelemetryEvent[] = [];
    v.telemetry.use({ record: (e) => events.push(e) });
    const res = await app.handle(get("/users/7", { "x-api-version": "2025-01-01" }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.route).toBe("GET /users/:*");
    expect(event.version).toBe("2025-01-01");
    expect(event.status).toBe(200);
    expect(event.adapter).toBe("elysia");
    expect(event.transformCount).toBeGreaterThan(0);
    expect(event.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("hands the serverless telemetry flush to the platform lifecycle", async () => {
    process.env.VERCEL = "1";
    const v = makeInstance(BEFORE_SUNSET);
    let releaseFlush: (() => void) | undefined;
    const flushBlocked = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    let flushStarted = false;
    v.telemetry.use({
      record: () => {},
      flush: async () => {
        flushStarted = true;
        await flushBlocked;
      },
    });

    let handedOff: Promise<void> | undefined;
    const app = makeApp(v, {
      waitUntil: (pending) => {
        handedOff = pending;
      },
    });
    expect((await app.handle(get("/users/7"))).status).toBe(200);
    expect(flushStarted).toBe(true);
    expect(handedOff).toBeDefined();

    releaseFlush?.();
    await handedOff;
  });

  test("streaming Response bodies pass through untouched for old clients", async () => {
    const { app } = fixture();
    const res = await app.handle(get("/stream", { "x-api-version": "2025-01-01" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe("chunk-1");
    // Sunset headers still apply to passthrough responses.
    expect(res.headers.get("sunset")).not.toBeNull();
  });
});
