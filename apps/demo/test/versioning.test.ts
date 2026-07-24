/**
 * Dogfood: end-to-end wire behavior of BOTH transports on the demo app —
 * the TanStack Start handler wrappers (up/down transforms, jump, rewrite
 * alias, sunset headers, invalid version) and the oRPC interceptors — by
 * dispatching real Requests to the exact handler maps the route files mount.
 */
import { describe, expect, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "1";

const { usersHandlers, userByIdHandlers, teamByIdHandlers } = await import(
  "../src/server/handlers"
);
const { handleRpc } = await import("../src/server/rpc");

const base = "http://localhost";

function req(
  path: string,
  init: RequestInit = {},
  version?: string,
): Request {
  const headers = new Headers(init.headers);
  if (version) headers.set("x-api-version", version);
  return new Request(`${base}${path}`, { ...init, headers });
}

function rpcReq(path: string, input: unknown, version?: string): Request {
  return req(
    `/rpc/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    },
    version,
  );
}

describe("tanstack-start wire behavior per version", () => {
  test("unpinned client gets the current shape", async () => {
    const res = await userByIdHandlers.GET!({ request: req("/users/u_1") });
    expect(res.status).toBe(200);
    const user = await res.json();
    expect(user).toMatchObject({ id: "u_1", firstName: "Ada", lastName: "Lovelace" });
    expect(user.name).toBeUndefined();
  });

  test("client pinned before the name split gets the merged shape", async () => {
    const res = await userByIdHandlers.GET!({
      request: req("/users/u_1", {}, "2025-06-01"),
    });
    expect(res.status).toBe(200);
    const user = await res.json();
    expect(user).toMatchObject({ id: "u_1", name: "Ada Lovelace" });
    expect(user.firstName).toBeUndefined();
  });

  test("oldest cohort takes the registered jump on GET /users", async () => {
    const res = await usersHandlers.GET!({ request: req("/users", {}, "2025-01-01") });
    expect(res.status).toBe(200);
    const users = await res.json();
    expect(users[0]).toMatchObject({ id: "u_1", name: "Ada Lovelace" });
    expect(users[0].firstName).toBeUndefined();
  });

  test("old-shape request body is up-transformed before validation", async () => {
    const res = await usersHandlers.POST!({
      request: req(
        "/users",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Barbara Liskov", email: "barbara@wire.example.com" }),
        },
        "2025-06-01",
      ),
    });
    expect(res.status).toBe(200);
    // The response comes back down-transformed to the pinned shape...
    const created = await res.json();
    expect(created).toMatchObject({ name: "Barbara Liskov" });
    // ...but the handler stored the current split shape.
    const current = await (
      await userByIdHandlers.GET!({ request: req(`/users/${created.id}`) })
    ).json();
    expect(current).toMatchObject({ firstName: "Barbara", lastName: "Liskov" });
  });

  test("sunset-scheduled pins get Deprecation and Sunset headers", async () => {
    const res = await userByIdHandlers.GET!({
      request: req("/users/u_1", {}, "2025-01-01"),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("deprecation")).not.toBeNull();
    expect(res.headers.get("sunset")).toContain("2026");
    const fresh = await userByIdHandlers.GET!({
      request: req("/users/u_1", {}, "2026-05-14"),
    });
    expect(fresh.headers.get("sunset")).toBeNull();
  });

  test("invalid x-api-version is a 400 with a stable error code", async () => {
    const res = await usersHandlers.GET!({
      request: req("/users", {}, "not-a-version"),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_api_version");
  });

  test("rewrite alias serves /orgs/:id to pre-rename pins only", async () => {
    const { versionlessAlias } = await import("@versionless/adapter-tanstack-start");
    const { teamByIdGET } = await import("../src/server/handlers");
    const { v } = await import("../src/versions");
    // Same wiring as routes/orgs.$id.ts — including the /demo base prefix the
    // deployed app serves under (the alias derives the logical path from the
    // route pattern).
    const alias = versionlessAlias(v, teamByIdGET, { route: "/orgs/$id" });

    const old = await alias({ request: req("/demo/orgs/t_1", {}, "2025-01-01") });
    expect(old.status).toBe(200);
    expect(await old.json()).toMatchObject({ id: "t_1", name: "Compilers" });

    const current = await alias({ request: req("/demo/orgs/t_1") });
    expect(current.status).toBe(404);
  });
});

describe("oRPC wire behavior per version", () => {
  test("unpinned client gets the current shape", async () => {
    const res = await handleRpc(rpcReq("demo/userList", undefined), "/rpc");
    expect(res.status).toBe(200);
    const { json } = await res.json();
    expect(json[0]).toMatchObject({ id: "u_1", firstName: "Ada" });
    expect(json[0].name).toBeUndefined();
  });

  test("pinned-old output is down-transformed per procedure", async () => {
    const res = await handleRpc(
      rpcReq("demo/userList", undefined, "2025-06-01"),
      "/rpc",
    );
    expect(res.status).toBe(200);
    const { json } = await res.json();
    expect(json[0]).toMatchObject({ id: "u_1", name: "Ada Lovelace" });
    expect(json[0].firstName).toBeUndefined();
  });

  test("pinned-old input is up-transformed before .input() validation", async () => {
    const res = await handleRpc(
      rpcReq(
        "demo/userCreate",
        { name: "Annie Easley", email: "annie@wire.example.com" },
        "2025-06-01",
      ),
      "/rpc",
    );
    expect(res.status).toBe(200);
    const { json } = await res.json();
    expect(json).toMatchObject({ name: "Annie Easley" });
    expect(json.firstName).toBeUndefined();
  });

  test("sunset headers land on the RPC envelope", async () => {
    const res = await handleRpc(
      rpcReq("demo/userList", undefined, "2025-01-01"),
      "/rpc",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("deprecation")).not.toBeNull();
    expect(res.headers.get("sunset")).toContain("2026");
  });

  test("invalid pin throws BAD_REQUEST through the interceptor", async () => {
    const res = await handleRpc(
      rpcReq("demo/userList", undefined, "not-a-version"),
      "/rpc",
    );
    expect(res.status).toBe(400);
  });
});
