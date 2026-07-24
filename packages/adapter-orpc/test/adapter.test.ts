import { describe, expect, test } from "bun:test";
import { ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { TelemetryEvent, Versionless } from "@versionless/core";
import { createVersionless } from "@versionless/core";
import { z } from "zod";
import {
  versionlessClientInterceptor,
  versionlessContext,
  versionlessAdapterInterceptor,
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
  input: {
    up: ({ name, ...rest }: any) => {
      const [firstName, ...restName] = String(name).split(" ");
      return { ...rest, firstName, lastName: restName.join(" ") };
    },
  },
  output: {
    down: ({ firstName, lastName, ...rest }: any) => ({
      ...rest,
      name: `${firstName} ${lastName}`,
    }),
  },
});

v.change("2026-05-14", {
  describe: "split",
  procedures: ["user.get"],
  input: { up: (b: any) => b },
  output: {
    down: ({ firstName, lastName, ...rest }: any) => ({
      ...rest,
      name: `${firstName} ${lastName}`,
    }),
  },
});

v.change("2026-05-14", {
  describe: "user.fail: legacy error marker",
  procedures: ["user.fail"],
  error: { down: (shape: any) => ({ ...shape, data: { ...shape.data, legacy: true } }) },
});

v.change("2026-05-14", {
  describe: "user.list: split (input up would throw on undefined)",
  procedures: ["user.list"],
  input: {
    up: ({ name, ...rest }: any) => {
      const [firstName, ...restName] = String(name).split(" ");
      return { ...rest, firstName, lastName: restName.join(" ") };
    },
  },
  output: {
    down: (body: any) =>
      body.map(({ firstName, lastName, ...rest }: any) => ({
        ...rest,
        name: `${firstName} ${lastName}`,
      })),
  },
});

v.sunset("2025-01-01", { after: "2026-01-31" });

// Second instance: clock past the sunset cutoff -> pinned old clients are gone.
const v2 = makeInstance(() => new Date("2026-02-15T00:00:00Z"));
v2.sunset("2025-01-01", { after: "2026-01-31" });

// ---------------------------------------------------------------------------
// oRPC app

const router = {
  user: {
    get: os
      .input(z.object({ id: z.string() }))
      .handler(({ input }) => ({
        id: input.id,
        firstName: "Ada",
        lastName: "Lovelace",
      })),
    create: os
      .input(z.object({ firstName: z.string(), lastName: z.string() }))
      .handler(({ input }) => input),
    fail: os.input(z.object({ id: z.string() })).handler(() => {
      throw new ORPCError("NOT_FOUND", { message: "no such user" });
    }),
    // No .input(): a pinned call must NOT run request.up on undefined.
    list: os.handler(() => [{ id: "1", firstName: "Ada", lastName: "Lovelace" }]),
  },
};

function makeApp(instance: Versionless) {
  const handler = new RPCHandler(router, {
    adapterInterceptors: [versionlessAdapterInterceptor(instance)],
    clientInterceptors: [versionlessClientInterceptor()],
  });
  return async (req: Request): Promise<Response> => {
    const { matched, response } = await handler.handle(req, {
      prefix: "/rpc",
      context: { ...versionlessContext(instance, { request: req }) },
    });
    if (!matched || !response) return new Response("Not Found", { status: 404 });
    return response;
  };
}

const handle = makeApp(v);

/** RPC protocol call: POST /rpc/<path> with a `{ json }` envelope. */
function rpcReq(path: string, input: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/rpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ json: input }),
  });
}

// ---------------------------------------------------------------------------
// Tests

describe("@versionless/adapter-orpc", () => {
  test("unpinned client gets the current shape", async () => {
    const res = await handle(rpcReq("user/get", { id: "1" }));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.json).toEqual({ id: "1", firstName: "Ada", lastName: "Lovelace" });
    // Unpinned -> current version -> no sunset headers.
    expect(res.headers.get("sunset")).toBeNull();
  });

  test("pinned old client gets the joined name (output.down ran)", async () => {
    const res = await handle(
      rpcReq("user/get", { id: "1" }, { "x-api-version": "2025-01-01" }),
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.json).toEqual({ id: "1", name: "Ada Lovelace" });
    // Pinned to a sunsetting version, before cutoff -> Sunset/Deprecation
    // headers via versionlessAdapterInterceptor.
    expect(res.headers.get("sunset")).toContain("2026");
    expect(res.headers.get("deprecation")).toStartWith("@");
  });

  test("old-shape input passes current-shape validation and round-trips", async () => {
    const res = await handle(
      rpcReq("user/create", { name: "Ada Lovelace" }, { "x-api-version": "2025-01-01" }),
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    // input.up ran before zod validation ({name} -> {firstName,lastName}),
    // and output.down ran after ({firstName,lastName} -> {name}).
    expect(json.json).toEqual({ name: "Ada Lovelace" });
  });

  test("unpinned input uses the current shape untransformed", async () => {
    const res = await handle(
      rpcReq("user/create", { firstName: "Ada", lastName: "Lovelace" }),
    );
    const json: any = await res.json();
    expect(json.json).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  test("input-less procedure works pinned old (up skipped, output downed)", async () => {
    const res = await handle(
      rpcReq("user/list", undefined, { "x-api-version": "2025-01-01" }),
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.json).toEqual([{ id: "1", name: "Ada Lovelace" }]);
  });

  test("sunset past cutoff yields a 410 GONE error envelope", async () => {
    const handle2 = makeApp(v2);
    const res = await handle2(
      rpcReq("user/get", { id: "1" }, { "x-api-version": "2025-01-01" }),
    );
    expect(res.status).toBe(410);
    const json: any = await res.json();
    expect(json.json.code).toBe("GONE");
    expect(json.json.data.error).toBe("api_version_sunset");
    expect(json.json.data.version).toBe("2025-01-01");
    // Sunset headers still present on the 410 response.
    expect(res.headers.get("sunset")).toContain("2026");
  });

  test("error.down transforms thrown ORPCErrors for old clients", async () => {
    const pinned = await handle(
      rpcReq("user/fail", { id: "1" }, { "x-api-version": "2025-01-01" }),
    );
    expect(pinned.status).toBe(404);
    const pinnedJson: any = await pinned.json();
    expect(pinnedJson.json.message).toBe("no such user");
    expect(pinnedJson.json.data.legacy).toBe(true);

    const current = await handle(rpcReq("user/fail", { id: "1" }));
    const currentJson: any = await current.json();
    expect(currentJson.json.data?.legacy).toBeUndefined();
  });

  test("invalid version pin yields a BAD_REQUEST error envelope", async () => {
    const res = await handle(
      rpcReq("user/get", { id: "1" }, { "x-api-version": "not-a-date" }),
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.json.code).toBe("BAD_REQUEST");
    expect(json.json.message).toContain("not-a-date");
    expect(json.json.data.code).toBe("VERSION_INVALID");
  });

  test("reject policy maps future pins to BAD_REQUEST, not a 500", async () => {
    const rejecting = createVersionless({
      scheme: "date",
      current: "2026-07-21",
      resolve: [{ header: "x-api-version" }, { default: "current" }],
      onFutureVersion: "reject",
    });
    const res = await makeApp(rejecting)(
      rpcReq("user/get", { id: "1" }, { "x-api-version": "2027-01-01" }),
    );
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.json.code).toBe("BAD_REQUEST");
    expect(json.json.data.error).toBe("api_version_ahead");
    expect(json.json.data.requested).toBe("2027-01-01");
    expect(json.json.data.current).toBe("2026-07-21");
  });

  test("responses advertise the served version via the adapter interceptor", async () => {
    const res = await handle(
      rpcReq("user/get", { id: "1" }, { "x-api-version": "2025-06-01" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-version-served")).toBe("2025-06-01");
  });

  test("telemetry sink captures the procedure route", async () => {
    const events: TelemetryEvent[] = [];
    v.telemetry.use({ record: (event) => events.push(event) });

    await handle(rpcReq("user/get", { id: "7" }, { "x-api-version": "2025-01-01" }));
    await Bun.sleep(10);

    const event = events.find((e) => e.route === "trpc:user.get");
    expect(event).toBeDefined();
    expect(event!.adapter).toBe("orpc");
    expect(event!.method).toBe("TRPC");
    expect(event!.status).toBe(200);
    expect(event!.version).toBe("2025-01-01");
    expect(event!.transformCount).toBeGreaterThan(0);
  });

  test("missing context.versionless warns once and serves the current shape", async () => {
    const handler = new RPCHandler(router, {
      clientInterceptors: [versionlessClientInterceptor(v)],
    });

    const warned: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warned.push(args.map(String).join(" "));
    };
    try {
      // No versionlessContext: pinned header is ignored because the
      // interceptor has no header access without the stash.
      const { response } = await handler.handle(
        rpcReq("user/get", { id: "1" }, { "x-api-version": "2025-01-01" }),
        { prefix: "/rpc", context: {} },
      );
      const json: any = await response!.json();
      expect(json.json).toEqual({ id: "1", firstName: "Ada", lastName: "Lovelace" });
    } finally {
      console.warn = original;
    }
    expect(warned.some((w) => w.includes("context.versionless missing"))).toBe(true);
  });
});
