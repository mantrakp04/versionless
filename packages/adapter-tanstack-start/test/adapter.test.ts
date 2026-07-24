import { describe, expect, test } from "bun:test";
import { createVersionless } from "@versionless/core";
import type { TelemetryEvent } from "@versionless/core";
import { versionless, versionlessAlias } from "../src/index";

const CURRENT = "2026-07-21";
const BEFORE_SUNSET = "2026-01-15T00:00:00Z"; // sunset cutoff is 2026-01-31
const AFTER_SUNSET = "2026-03-01T00:00:00Z";

function buildFixture(now: string, onFutureVersion?: "clamp" | "reject") {
  const events: TelemetryEvent[] = [];
  const v = createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    clock: () => new Date(now),
    ...(onFutureVersion ? { onFutureVersion } : {}),
  });
  v.telemetry.use({ record: (event) => events.push(event) });

  v.change("2026-05-14", {
    describe: "split name into firstName/lastName",
    routes: ["GET /users/:id", "POST /users", "GET /plain"],
    request: {
      up: (body: { name?: string }) => {
        if (!body || typeof body.name !== "string") return body;
        const { name, ...rest } = body;
        const space = name.indexOf(" ");
        return space === -1
          ? { ...rest, firstName: name, lastName: "" }
          : { ...rest, firstName: name.slice(0, space), lastName: name.slice(space + 1) };
      },
    },
    response: {
      down: (body: { firstName?: string; lastName?: string }) => {
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

  const observed: unknown[] = [];

  // One wrapped handler map per route file, mirroring `server.handlers`.
  const users = versionless(
    v,
    {
      GET: async ({ request }) => {
        const id = new URL(request.url).pathname.split("/").pop();
        return Response.json({ id, firstName: "Ada", lastName: "Lovelace" });
      },
    },
    { route: "/users/$id" },
  );
  const usersCollection = versionless(
    v,
    {
      POST: async ({ request }) => {
        const body = await request.json();
        observed.push(body);
        return Response.json(body);
      },
    },
    { route: "/users" },
  );
  const teams = versionless(v, {
    GET: async ({ request }) => {
      const id = new URL(request.url).pathname.split("/").pop();
      return Response.json({ team: id });
    },
  });
  const orgs = { GET: versionlessAlias(v, teams.GET!) };
  const plain = versionless(v, {
    GET: async () => new Response("plain text", { headers: { "content-type": "text/plain" } }),
  });

  return { users, usersCollection, teams, orgs, plain, events, observed };
}

const BASE = "http://localhost";
const call = (request: Request) => ({ request });

describe("@versionless/adapter-tanstack-start", () => {
  test("unpinned client gets the current shape", async () => {
    const { users } = buildFixture(BEFORE_SUNSET);
    const res = await users.GET!(call(new Request(`${BASE}/users/1`)));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-version-served")).toBe(CURRENT);
    expect(await res.json()).toEqual({ id: "1", firstName: "Ada", lastName: "Lovelace" });
  });

  test("future pins clamp to current and advertise the drift", async () => {
    const { users } = buildFixture(BEFORE_SUNSET);
    const res = await users.GET!(
      call(new Request(`${BASE}/users/1`, { headers: { "x-api-version": "2027-01-01" } })),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-version-served")).toBe(CURRENT);
    expect(res.headers.get("x-api-version-requested")).toBe("2027-01-01");
  });

  test("reject policy maps future pins to 400 api_version_ahead", async () => {
    const { users } = buildFixture(BEFORE_SUNSET, "reject");
    const res = await users.GET!(
      call(new Request(`${BASE}/users/1`, { headers: { "x-api-version": "2027-01-01" } })),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("x-versionless-error")).toBe("VERSION_AHEAD");
    expect(res.headers.get("x-api-version-served")).toBe(CURRENT);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("api_version_ahead");
    expect(body.requested).toBe("2027-01-01");
    expect(body.current).toBe(CURRENT);
  });

  test("old pin GET gets the down-transformed {name} shape", async () => {
    const { users } = buildFixture(BEFORE_SUNSET);
    const res = await users.GET!(
      call(new Request(`${BASE}/users/1`, { headers: { "x-api-version": "2025-06-01" } })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", name: "Ada Lovelace" });
  });

  test("old pin POST is up-transformed for the handler and down-transformed back", async () => {
    const { usersCollection, observed } = buildFixture(BEFORE_SUNSET);
    const res = await usersCollection.POST!(
      call(
        new Request(`${BASE}/users`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-version": "2025-06-01",
          },
          body: JSON.stringify({ name: "Grace Hopper" }),
        }),
      ),
    );
    expect(res.status).toBe(200);
    // Handler-side observation: the echo handler saw the current (new) shape.
    expect(observed).toEqual([{ firstName: "Grace", lastName: "Hopper" }]);
    // The echoed response came back down-transformed to the old shape.
    expect(await res.json()).toEqual({ name: "Grace Hopper" });
  });

  test("old pin GET /orgs/:id is aliased to GET /teams/:id", async () => {
    const { orgs } = buildFixture(BEFORE_SUNSET);
    const res = await orgs.GET(
      call(new Request(`${BASE}/orgs/7`, { headers: { "x-api-version": "2025-01-01" } })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ team: "7" });
  });

  test("current client hitting the rewritten-away path gets a 404", async () => {
    const { orgs } = buildFixture(BEFORE_SUNSET);
    const res = await orgs.GET(call(new Request(`${BASE}/orgs/7`)));
    expect(res.status).toBe(404);
  });

  test("sunset-scheduled version gets Sunset/Deprecation headers before the cutoff", async () => {
    const { users } = buildFixture(BEFORE_SUNSET);
    const res = await users.GET!(
      call(new Request(`${BASE}/users/1`, { headers: { "x-api-version": "2025-01-01" } })),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("sunset")).toBe(
      new Date(Date.UTC(2026, 0, 31, 23, 59, 59, 999)).toUTCString(),
    );
    expect(res.headers.get("deprecation")).toMatch(/^@\d+$/);
  });

  test("sunset version gets a 410 after the cutoff", async () => {
    const { users } = buildFixture(AFTER_SUNSET);
    const res = await users.GET!(
      call(new Request(`${BASE}/users/1`, { headers: { "x-api-version": "2025-01-01" } })),
    );
    expect(res.status).toBe(410);
    expect(res.headers.get("sunset")).toBeTruthy();
    const body = (await res.json()) as { error: string; version: string; sunset: string };
    expect(body.error).toBe("api_version_sunset");
    expect(body.version).toBe("2025-01-01");
    expect(body.sunset).toBe("2026-01-31");
  });

  test("invalid version pin gets a 400", async () => {
    const { users } = buildFixture(BEFORE_SUNSET);
    const res = await users.GET!(
      call(new Request(`${BASE}/users/1`, { headers: { "x-api-version": "not-a-date" } })),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("x-versionless-error")).toBe("VERSION_INVALID");
    const body = (await res.json()) as { error: string; code: string; message: string };
    expect(body.error).toBe("invalid_api_version");
    expect(body.code).toBe("VERSION_INVALID");
    expect(body.message).toContain("not-a-date");
  });

  test("telemetry event is emitted per request", async () => {
    const { users, events } = buildFixture(BEFORE_SUNSET);
    const res = await users.GET!(
      call(new Request(`${BASE}/users/1`, { headers: { "x-api-version": "2025-06-01" } })),
    );
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.adapter).toBe("tanstack-start");
    expect(event.method).toBe("GET");
    expect(event.route).toBe("GET /users/:*");
    expect(event.version).toBe("2025-06-01");
    expect(event.requestedVersion).toBeUndefined();
    expect(event.transformCount).toBe(2);
    expect(event.status).toBe(200);
    expect(event.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("non-JSON response on a changed route passes through untouched", async () => {
    const { plain } = buildFixture(BEFORE_SUNSET);
    const res = await plain.GET!(
      call(new Request(`${BASE}/plain`, { headers: { "x-api-version": "2025-06-01" } })),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").not.toContain("application/json");
    expect(await res.text()).toBe("plain text");
  });
});
