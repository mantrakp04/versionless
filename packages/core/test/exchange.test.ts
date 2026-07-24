import { describe, expect, test } from "bun:test";
import { createVersionless } from "../src/index";
import type { Exchange, ExchangeInput, TelemetryEvent } from "../src/types";

const CURRENT = "2026-07-21";

function makeApi(opts?: { clock?: () => Date }) {
  const v = createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    // Default the clock to before the demo sunset so tests are stable in
    // real time; sunset-specific tests inject their own clock.
    clock: opts?.clock ?? (() => new Date("2026-01-01T00:00:00Z")),
  });

  // Chain on GET /users/:id — three stacked changes:
  // 2025-03-01: response gained `id` prefix change (old clients see numeric id)
  v.change("2025-03-01", {
    describe: "ids became strings",
    routes: ["GET /users/:id", "POST /users"],
    request: {
      up: (body: any) => body, // request shape unchanged for GET
    },
    response: {
      down: (body: any) => ({ ...body, id: Number(String(body.id).replace("u_", "")) }),
    },
  });
  // 2025-09-01: `email` split out of `contact`
  v.change("2025-09-01", {
    describe: "contact object split into email",
    routes: ["GET /users/:id", "POST /users"],
    request: {
      up: (body: any) => {
        const { contact, ...rest } = body;
        return { ...rest, email: contact?.email };
      },
    },
    response: {
      down: ({ email, ...rest }: any) => ({ ...rest, contact: { email } }),
    },
    error: {
      down: (body: any) => ({ ...body, legacy: true }),
    },
  });
  // 2026-05-14: name split into firstName/lastName
  v.change("2026-05-14", {
    describe: "user.name split into firstName/lastName",
    routes: ["GET /users/:id", "POST /users"],
    request: {
      up: (body: { name: string }) => {
        const { name, ...rest } = body as any;
        const [firstName, ...restName] = String(name).split(" ");
        return { ...rest, firstName, lastName: restName.join(" ") };
      },
    },
    response: {
      down: ({ firstName, lastName, ...rest }: any) => ({
        ...rest,
        name: `${firstName} ${lastName}`.trim(),
      }),
    },
  });

  // Rewrite: /orgs -> /teams at 2025-06-01
  v.change("2025-06-01", {
    describe: "orgs renamed to teams",
    rewrite: { from: "GET /orgs/:id", to: "GET /teams/:id" },
  });

  // Sunset the 2025-03-01 floor after 2026-01-31
  v.sunset("2025-03-01", { after: "2026-01-31", message: "upgrade please" });

  return v;
}

function input(overrides: Partial<ExchangeInput> & { headers?: Record<string, string> }): ExchangeInput {
  const headers = overrides.headers ?? {};
  return {
    method: overrides.method ?? "GET",
    path: overrides.path ?? "/users/u_42",
    matchedRoute: overrides.matchedRoute,
    procedure: overrides.procedure,
    adapter: "test",
    getHeader: (name) => headers[name.toLowerCase()] ?? null,
  };
}

async function open(v: ReturnType<typeof makeApi>, i: ExchangeInput): Promise<Exchange> {
  return await v.openExchange(i);
}

describe("GATE A: end-to-end exchange round-trip", () => {
  test("client pinned below the floor gets the full up/down chain", async () => {
    const v = makeApi();
    // Pinned before the earliest change: every transform applies. (A client
    // pinned AT 2025-03-01 already speaks that version's shape.)
    const ex = await open(
      v,
      input({
        method: "POST",
        path: "/users",
        matchedRoute: "/users",
        headers: { "x-api-version": "2025-01-01" },
      }),
    );
    expect(ex.routeKey).toBe("POST /users");
    expect(ex.gone).toBeNull();

    // Old wire shape in: name + contact.
    const upped = await ex.up({
      name: "Ada Lovelace",
      contact: { email: "ada@lovelace.dev" },
    });
    // Handler sees the CURRENT shape.
    expect(upped).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@lovelace.dev",
    });

    // Handler responds in CURRENT shape; client gets its pinned shape back.
    const downed = await ex.down({
      id: "u_42",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@lovelace.dev",
    });
    expect(downed).toEqual({
      id: 42,
      name: "Ada Lovelace",
      contact: { email: "ada@lovelace.dev" },
    });
  });

  test("client pinned mid-chain gets only newer transforms", async () => {
    const v = makeApi();
    const ex = await open(
      v,
      input({
        matchedRoute: "/users/:id",
        headers: { "x-api-version": "2025-09-01" },
      }),
    );
    const downed = await ex.down({
      id: "u_42",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "a@b.c",
    });
    // 2026-05-14's down applies (name merge); 2025-09-01's and older do not.
    expect(downed).toEqual({ id: "u_42", name: "Ada Lovelace", email: "a@b.c" });
  });

  test("current clients hit the identity pipeline", async () => {
    const v = makeApi();
    const ex = await open(v, input({ matchedRoute: "/users/:id", headers: {} }));
    expect(ex.version).toBe(CURRENT);
    expect(ex.transformCount).toBe(0);
    const body = { firstName: "A", lastName: "B" };
    expect(ex.down(body)).toBe(body);
  });

  test("unknown pinned dates normalize to the release at-or-before", async () => {
    const v = makeApi();
    const ex = await open(
      v,
      input({ matchedRoute: "/users/:id", headers: { "x-api-version": "2026-01-15" } }),
    );
    expect(ex.version).toBe("2025-09-01");
    expect(ex.requestedVersion).toBe("2026-01-15");
  });

  test("a jump overrides the chained changes it spans", async () => {
    const v = makeApi();
    const jumpUp = (body: any) => ({ ...body, viaJump: true });
    v.jump({
      from: "2025-03-01",
      to: "2026-05-14",
      routes: ["GET /users/:id"],
      request: { up: jumpUp },
      response: { down: (body: any) => ({ ...body, jumpDown: true }) },
    });
    const ex = await open(
      v,
      input({ matchedRoute: "/users/:id", headers: { "x-api-version": "2025-03-01" } }),
    );
    // Path: jump (03-01 -> 05-14) then chained 2026-05-14 change... wait, the
    // jump lands ON 2026-05-14, so that change (introduced at 05-14) is
    // already known to the position. Remaining chain after 05-14: nothing.
    const upped = await ex.up({ name: "Ada L" });
    // Only the jump's up ran — the spanned 2025-09-01 and 2026-05-14 changes
    // were skipped.
    expect(upped).toEqual({ name: "Ada L", viaJump: true });
    const downed = await ex.down({ firstName: "Ada" });
    expect(downed).toEqual({ firstName: "Ada", jumpDown: true });
  });

  test("rewrites redirect old clients to the new route", async () => {
    const v = makeApi();
    const ex = await open(
      v,
      input({ path: "/orgs/7", headers: { "x-api-version": "2025-03-01" } }),
    );
    expect(ex.rewrite).toEqual({ method: "GET", path: "/teams/7" });
    // Clients at/after the rename call /teams directly — no rewrite.
    const ex2 = await open(
      v,
      input({ path: "/orgs/7", headers: { "x-api-version": "2025-06-01" } }),
    );
    expect(ex2.rewrite).toBeNull();
  });

  test("error responses get the error down chain", async () => {
    const v = makeApi();
    const ex = await open(
      v,
      input({ matchedRoute: "/users/:id", headers: { "x-api-version": "2025-03-01" } }),
    );
    const downed = await ex.downError({ error: "not_found" });
    expect(downed).toEqual({ error: "not_found", legacy: true });
  });

  test("sunset: headers before the date, 410 after", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const v = makeApi({ clock: () => now });
    const before = await open(
      v,
      input({ matchedRoute: "/users/:id", headers: { "x-api-version": "2025-03-01" } }),
    );
    expect(before.gone).toBeNull();
    expect(before.responseHeaders.Sunset).toContain("Jan 2026");
    expect(before.responseHeaders.Deprecation).toMatch(/^@\d+$/);
    expect(before.responseHeaders["x-api-version-served"]).toBe("2025-03-01");

    now = new Date("2026-02-01T00:00:00Z");
    // New instance: sunset verdicts are memoized 60s per version.
    const v2 = makeApi({ clock: () => now });
    const after = await open(
      v2,
      input({ matchedRoute: "/users/:id", headers: { "x-api-version": "2025-03-01" } }),
    );
    expect(after.gone).toEqual({
      status: 410,
      body: {
        error: "api_version_sunset",
        code: "VERSION_SUNSET",
        version: "2025-03-01",
        sunset: "2026-01-31",
        message: "upgrade please",
      },
    });
    // Newer clients are unaffected.
    const fresh = await open(v2, input({ matchedRoute: "/users/:id", headers: {} }));
    expect(fresh.gone).toBeNull();
    // No sunset signals for current clients — just the version contract.
    expect(fresh.responseHeaders).toEqual({ "x-api-version-served": CURRENT });
  });

  test("invalid version -> VersionResolutionError", async () => {
    const v = makeApi();
    expect(() =>
      v.openExchange(input({ headers: { "x-api-version": "not-a-date" } })),
    ).toThrow(/Invalid API version/);
  });

  test("telemetry: finish() emits one event with drift info", async () => {
    const v = makeApi();
    const events: TelemetryEvent[] = [];
    v.telemetry.use({ record: (e) => events.push(e) });
    const ex = await open(
      v,
      input({ matchedRoute: "/users/:id", headers: { "x-api-version": "2026-01-15", "x-api-key": "key_1" } }),
    );
    ex.finish({ latencyMs: 12, status: 200 });
    await new Promise((r) => setTimeout(r, 0)); // microtask fan-out
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: "GET",
      route: "GET /users/:*",
      version: "2025-09-01",
      requestedVersion: "2026-01-15",
      consumerKey: "key_1",
      status: 200,
      adapter: "test",
    });
    expect(events[0]!.transformCount).toBeGreaterThan(0);
  });

  test("tRPC procedures route through trpc: keys", async () => {
    const v = makeApi();
    v.change("2026-05-14", {
      describe: "user.get output split",
      procedures: ["user.get"],
      output: {
        down: ({ firstName, lastName, ...rest }: any) => ({
          ...rest,
          name: `${firstName} ${lastName}`,
        }),
      },
    });
    const ex = await open(
      v,
      input({
        method: "POST",
        path: "/trpc/user.get",
        procedure: "user.get",
        headers: { "x-api-version": "2025-03-01" },
      }),
    );
    expect(ex.routeKey).toBe("trpc:user.get");
    const downed = await ex.down({ firstName: "Ada", lastName: "L" });
    expect(downed).toEqual({ name: "Ada L" });
  });
});
