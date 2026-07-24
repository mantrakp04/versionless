import { afterAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createVersionless } from "@versionless/core";
import type { TelemetryEvent, Versionless } from "@versionless/core";
import express from "express";
import { versionless } from "../src/index";

const CURRENT = "2026-07-21";
const OLD_PIN = "2025-01-01"; // before both changes; also the sunset version

function makeInstance(
  clock: () => Date,
  onFutureVersion?: "clamp" | "reject",
): Versionless {
  const v = createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    clock,
    ...(onFutureVersion ? { onFutureVersion } : {}),
  });
  v.change("2026-05-14", {
    describe: "split name into firstName/lastName",
    routes: ["GET /users/:id", "POST /users"],
    request: {
      up: (b: any) => {
        const [firstName, ...rest] = String(b.name).split(" ");
        return { firstName, lastName: rest.join(" ") };
      },
    },
    response: {
      down: (b: any) => ({ name: `${b.firstName} ${b.lastName}` }),
    },
    error: {
      down: (b: any) => ({ ...b, legacy: true }),
    },
  });
  v.change("2025-06-01", {
    describe: "orgs renamed to teams",
    rewrite: { from: "GET /orgs/:id", to: "GET /teams/:id" },
  });
  v.sunset(OLD_PIN, { after: "2026-01-31" });
  return v;
}

function makeApp(v: Versionless, seen: unknown[]) {
  const app = express();
  app.use(express.json());
  app.use(versionless(v));
  app.get("/users/:id", (req, res) => {
    if (req.params.id === "missing") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ id: req.params.id, firstName: "Ada", lastName: "Lovelace" });
  });
  app.post("/users", (req, res) => {
    seen.push(req.body);
    res.json(req.body);
  });
  app.get("/teams/:id", (req, res) => {
    res.json({ team: req.params.id });
  });
  return app;
}

function listen(app: express.Express): { server: Server; base: string } {
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://localhost:${port}` };
}

// Instance A: clocked before the sunset cutoff (2026-01-31).
const seen: unknown[] = [];
const vA = makeInstance(() => new Date("2026-01-15T00:00:00Z"));
const events: TelemetryEvent[] = [];
vA.telemetry.use({ record: (e) => events.push(e) });
const { server: serverA, base: baseA } = listen(makeApp(vA, seen));

// Instance B: clocked after the cutoff, for the 410 test.
const vB = makeInstance(() => new Date("2026-03-01T00:00:00Z"));
const { server: serverB, base: baseB } = listen(makeApp(vB, []));

// Instance C: reject policy, for the FutureVersionError mapping test.
const vC = makeInstance(() => new Date("2026-01-15T00:00:00Z"), "reject");
const { server: serverC, base: baseC } = listen(makeApp(vC, []));

afterAll(() => {
  serverA.close();
  serverB.close();
  serverC.close();
});

describe("@versionless/adapter-express", () => {
  test("unpinned request gets the current shape", async () => {
    const res = await fetch(`${baseA}/users/1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-version-served")).toBe(CURRENT);
    expect(await res.json()).toEqual({ id: "1", firstName: "Ada", lastName: "Lovelace" });
  });

  test("future pins clamp to current and advertise the drift", async () => {
    const res = await fetch(`${baseA}/users/1`, {
      headers: { "x-api-version": "2027-01-01" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-version-served")).toBe(CURRENT);
    expect(res.headers.get("x-api-version-requested")).toBe("2027-01-01");
  });

  test("reject policy maps future pins to 400 api_version_ahead", async () => {
    const res = await fetch(`${baseC}/users/1`, {
      headers: { "x-api-version": "2027-01-01" },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("x-versionless-error")).toBe("VERSION_AHEAD");
    expect(res.headers.get("x-api-version-served")).toBe(CURRENT);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("api_version_ahead");
    expect(body.requested).toBe("2027-01-01");
    expect(body.current).toBe(CURRENT);
  });

  test("old pin GET gets the downgraded shape", async () => {
    const res = await fetch(`${baseA}/users/1`, {
      headers: { "x-api-version": OLD_PIN },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Ada Lovelace" });
  });

  test("old pin POST: handler sees current shape, client gets old shape back", async () => {
    const res = await fetch(`${baseA}/users`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-version": OLD_PIN },
      body: JSON.stringify({ name: "Ada Lovelace" }),
    });
    expect(res.status).toBe(200);
    expect(seen[0]).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(await res.json()).toEqual({ name: "Ada Lovelace" });
  });

  test("old pin GET /orgs/:id is rewritten to /teams/:id", async () => {
    const res = await fetch(`${baseA}/orgs/7`, {
      headers: { "x-api-version": OLD_PIN },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ team: "7" });
  });

  test("new pin GET /orgs/:id is 404 (no rewrite)", async () => {
    const res = await fetch(`${baseA}/orgs/7`, {
      headers: { "x-api-version": CURRENT },
    });
    expect(res.status).toBe(404);
  });

  test("sunset headers are present on old pins", async () => {
    const res = await fetch(`${baseA}/users/1`, {
      headers: { "x-api-version": OLD_PIN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("sunset")).toBeTruthy();
    expect(res.headers.get("deprecation")).toBeTruthy();
  });

  test("sunset version gets 410 after the cutoff", async () => {
    const res = await fetch(`${baseB}/users/1`, {
      headers: { "x-api-version": OLD_PIN },
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("api_version_sunset");
    expect(body.version).toBe(OLD_PIN);
    expect(body.sunset).toBe("2026-01-31");
  });

  test("invalid version header is a 400 invalid_api_version", async () => {
    const res = await fetch(`${baseA}/users/1`, {
      headers: { "x-api-version": "not-a-version" },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("x-versionless-error")).toBe("VERSION_INVALID");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_api_version");
    expect(body.code).toBe("VERSION_INVALID");
    expect(typeof body.message).toBe("string");
  });

  test("telemetry events are emitted on finish", async () => {
    events.length = 0;
    const res = await fetch(`${baseA}/users/1`, {
      headers: { "x-api-version": OLD_PIN },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.method).toBe("GET");
    expect(e.route).toBe("GET /users/:*"); // canonical (normalized) route key
    expect(e.adapter).toBe("express");
    expect(e.version).toBe(OLD_PIN);
    expect(e.status).toBe(200);
    expect(e.transformCount).toBeGreaterThan(0);
    expect(e.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("error responses get error.down applied for old pins", async () => {
    const res = await fetch(`${baseA}/users/missing`, {
      headers: { "x-api-version": OLD_PIN },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", legacy: true });
  });
});
