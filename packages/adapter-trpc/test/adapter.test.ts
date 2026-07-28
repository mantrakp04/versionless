import { describe, expect, test } from "bun:test";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type {
  TelemetryEvent,
  Tracing,
  TracingSpan,
  Versionless,
} from "@versionless/core";
import { createVersionless } from "@versionless/core";
import { z } from "zod";
import {
  versionlessContext,
  versionlessErrorFormatter,
  versionlessMiddleware,
  versionlessResponseMeta,
  type VersionlessContext,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures

function makeInstance(clock: () => Date) {
  return createVersionless({
    scheme: "date",
    current: "2026-07-21",
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    clock,
  });
}

// Main instance: clock before the sunset cutoff (sunset headers, never gone).
const v = makeInstance(() => new Date("2026-01-01T00:00:00Z"));

v.change("2026-03-01", {
  describe: "user.create: name -> firstName/lastName",
  procedures: ["user.create"],
  request: {
    up: ({ name, ...rest }: any) => {
      const [firstName, ...restName] = String(name).split(" ");
      return { ...rest, firstName, lastName: restName.join(" ") };
    },
  },
  response: {
    down: ({ firstName, lastName, ...rest }: any) => ({
      ...rest,
      name: `${firstName} ${lastName}`,
    }),
  },
});

v.change("2026-05-14", {
  describe: "split",
  procedures: ["user.get"],
  request: { up: (b: any) => b },
  response: {
    down: ({ firstName, lastName, ...rest }: any) => ({
      ...rest,
      name: `${firstName} ${lastName}`,
    }),
  },
});

v.change("2026-05-14", {
  describe: "user.fail: legacy error marker",
  procedures: ["user.fail"],
  error: { down: (shape: any) => ({ ...shape, legacy: true }) },
});

v.sunset("2025-01-01", { after: "2026-01-31" });

// Second instance: clock past the sunset cutoff -> pinned old clients are gone.
const v2 = makeInstance(() => new Date("2026-02-15T00:00:00Z"));
v2.sunset("2025-01-01", { after: "2026-01-31" });

// ---------------------------------------------------------------------------
// tRPC app

function makeApp(instance: Versionless) {
  const t = initTRPC.context<VersionlessContext>().create({
    errorFormatter: versionlessErrorFormatter(instance),
  });
  const proc = t.procedure.use(versionlessMiddleware());
  const router = t.router({
    user: {
      get: proc
        .input(z.object({ id: z.string() }))
        .query(({ input }) => ({
          id: input.id,
          firstName: "Ada",
          lastName: "Lovelace",
        })),
      create: proc
        .input(z.object({ firstName: z.string(), lastName: z.string() }))
        .mutation(({ input }) => input),
      fail: proc.input(z.object({ id: z.string() })).query(() => {
        throw new TRPCError({ code: "NOT_FOUND", message: "no such user" });
      }),
    },
  });
  return (req: Request) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req,
      router,
      createContext: ({ req }) => versionlessContext(instance, { req }),
      responseMeta: versionlessResponseMeta(instance),
    });
}

const handle = makeApp(v);

function getReq(
  path: string,
  input: unknown,
  headers: Record<string, string> = {},
) {
  const encoded = encodeURIComponent(JSON.stringify(input));
  return new Request(`http://localhost/trpc/${path}?input=${encoded}`, {
    headers,
  });
}

function postReq(
  path: string,
  input: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Tests

describe("@versionless/adapter-trpc", () => {
  test("unpinned client gets the current shape", async () => {
    const res = await handle(getReq("user.get", { id: "1" }));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.result.data).toEqual({
      id: "1",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    // Unpinned -> current version -> no sunset headers.
    expect(res.headers.get("sunset")).toBeNull();
  });

  test("pinned old client gets the joined name (response.down ran)", async () => {
    const res = await handle(
      getReq("user.get", { id: "1" }, { "x-api-version": "2025-01-01" }),
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.result.data).toEqual({ id: "1", name: "Ada Lovelace" });
    // Pinned to a sunsetting version, before cutoff -> Sunset/Deprecation
    // headers via versionlessResponseMeta.
    expect(res.headers.get("sunset")).toContain("2026");
    expect(res.headers.get("deprecation")).toStartWith("@");
    expect(res.headers.get("x-api-version-served")).toBe("2025-01-01");
  });

  test("future pins advertise the requested and clamped versions", async () => {
    const res = await handle(
      getReq("user.get", { id: "1" }, { "x-api-version": "2027-01-01" }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-version-served")).toBe("2026-07-21");
    expect(res.headers.get("x-api-version-requested")).toBe("2027-01-01");
  });

  test("reject policy maps future pins to BAD_REQUEST, not a 500", async () => {
    const rejecting = createVersionless({
      scheme: "date",
      current: "2026-07-21",
      resolve: [{ header: "x-api-version" }, { default: "current" }],
      onFutureVersion: "reject",
    });
    const res = await makeApp(rejecting)(
      getReq("user.get", { id: "1" }, { "x-api-version": "2027-01-01" }),
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error.data.code).toBe("BAD_REQUEST");
    expect(json.error.message).toContain("2027-01-01");
    expect(json.error.message).toContain("2026-07-21");
  });

  test("old-shape mutation input passes current-shape validation and round-trips", async () => {
    const res = await handle(
      postReq(
        "user.create",
        { name: "Ada Lovelace" },
        { "x-api-version": "2025-01-01" },
      ),
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    // request.up ran before zod validation ({name} -> {firstName,lastName}),
    // and response.down ran after ({firstName,lastName} -> {name}).
    expect(json.result.data).toEqual({ name: "Ada Lovelace" });
  });

  test("unpinned mutation uses the current shape untransformed", async () => {
    const res = await handle(
      postReq("user.create", { firstName: "Ada", lastName: "Lovelace" }),
    );
    const json: any = await res.json();
    expect(json.result.data).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  test("sunset past cutoff yields PRECONDITION_FAILED in the error envelope", async () => {
    const handle2 = makeApp(v2);
    const res = await handle2(
      getReq("user.get", { id: "1" }, { "x-api-version": "2025-01-01" }),
    );
    expect(res.status).toBe(412);
    const json: any = await res.json();
    expect(json.error.message).toBe("api_version_sunset");
    expect(json.error.data.code).toBe("PRECONDITION_FAILED");
    expect(json.error.data.httpStatus).toBe(412);
    // Sunset headers still present on the 410-equivalent response.
    expect(res.headers.get("sunset")).toContain("2026");
  });

  test("errorFormatter applies sync error.down for old clients", async () => {
    const pinned = await handle(
      getReq("user.fail", { id: "1" }, { "x-api-version": "2025-01-01" }),
    );
    const pinnedJson: any = await pinned.json();
    expect(pinnedJson.error.message).toBe("no such user");
    expect(pinnedJson.error.legacy).toBe(true);

    const current = await handle(getReq("user.fail", { id: "1" }));
    const currentJson: any = await current.json();
    expect(currentJson.error.legacy).toBeUndefined();
  });

  test("telemetry sink captures the trpc route", async () => {
    const events: TelemetryEvent[] = [];
    v.telemetry.use({ record: (event) => events.push(event) });

    await handle(
      getReq("user.get", { id: "7" }, { "x-api-version": "2025-01-01" }),
    );
    await Bun.sleep(10);

    const event = events.find((e) => e.route === "trpc:user.get");
    expect(event).toBeDefined();
    expect(event!.adapter).toBe("trpc");
    expect(event!.method).toBe("TRPC");
    expect(event!.status).toBe(200);
    expect(event!.version).toBe("2025-01-01");
    expect(event!.transformCount).toBeGreaterThan(0);
  });

  test("metadata helpers end tracing without duplicate telemetry", async () => {
    let rootsStarted = 0;
    let rootsEnded = 0;
    const tracing: Tracing = {
      startSpan(name): TracingSpan {
        if (name === "versionless.exchange") rootsStarted++;
        return {
          setAttributes() {},
          recordException() {},
          end() {
            if (name === "versionless.exchange") rootsEnded++;
          },
        };
      },
      withSpan(_name, _attrs, _parent, fn) {
        return fn({
          setAttributes() {},
          recordException() {},
          end() {},
        });
      },
    };
    const instance = createVersionless({
      scheme: "date",
      current: "2026-07-21",
      resolve: [{ header: "x-api-version" }, { default: "current" }],
      tracing,
    });
    const events: TelemetryEvent[] = [];
    instance.telemetry.use({ record: (event) => events.push(event) });
    const ctx = versionlessContext(instance, {
      req: getReq(
        "user.get",
        { id: "1" },
        { "x-api-version": "2027-01-01" },
      ),
    });

    const meta = versionlessResponseMeta(instance)({ ctx });
    expect(meta.headers).toMatchObject({
      "x-api-version-served": "2026-07-21",
      "x-api-version-requested": "2027-01-01",
    });

    versionlessErrorFormatter(instance)({
      shape: {
        code: -32603,
        message: "failed",
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          path: "user.get",
        },
      },
      path: "user.get",
      ctx,
    });

    await Bun.sleep(0);
    expect(rootsStarted).toBe(2);
    expect(rootsEnded).toBe(2);
    expect(events).toEqual([]);
  });

  test("missing ctx.versionless warns once and serves the current shape", async () => {
    const t = initTRPC.create();
    const proc = t.procedure.use(versionlessMiddleware(v));
    const router = t.router({
      user: {
        get: proc
          .input(z.object({ id: z.string() }))
          .query(({ input }) => ({
            id: input.id,
            firstName: "Ada",
            lastName: "Lovelace",
          })),
      },
    });

    const warned: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warned.push(args.map(String).join(" "));
    };
    try {
      // No createContext: ctx has no versionless stash. Pinned header is
      // ignored because the middleware has no header access without the stash.
      const res = await fetchRequestHandler({
        endpoint: "/trpc",
        req: getReq("user.get", { id: "1" }, { "x-api-version": "2025-01-01" }),
        router,
      });
      const json: any = await res.json();
      expect(json.result.data).toEqual({
        id: "1",
        firstName: "Ada",
        lastName: "Lovelace",
      });
    } finally {
      console.warn = original;
    }
    expect(
      warned.some((w) => w.includes("ctx.versionless missing")),
    ).toBe(true);
  });
});
