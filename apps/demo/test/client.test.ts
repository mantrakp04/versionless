/**
 * Dogfood: the typed @versionless/client SDK against the demo's own handler
 * maps, transported in-process — full loop, no port. Types flow from ONE
 * parent source: drizzle schema -> zod -> handlers -> change chain ->
 * ClientTypes -> this client.
 */
import { describe, expect, test } from "bun:test";
import { expectTypeOf } from "expect-type";
import { createClient } from "@versionless/client";
import type { Team, User } from "@versionless/db/schema/demo";

process.env.SKIP_ENV_VALIDATION = "1";

const { usersHandlers, userByIdHandlers, teamByIdHandlers } = await import(
  "../src/server/handlers"
);
const { demoApi } = await import("../src/versions");
type DemoApi = typeof demoApi;

// Current shapes for routes the change chain doesn't touch (or to anchor the
// current side) — derived from the db types, never handwritten.
type Shapes = {
  "GET /users/:id": { response: User };
  "GET /teams/:id": { response: Team };
};

type UserV1 = Omit<User, "firstName" | "lastName"> & { name: string };

// In-process transport: dispatch by method+path to the exact handler maps the
// route files mount.
async function dispatch(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const ctx = { request: req };
  if (pathname === "/users") {
    const handler = req.method === "POST" ? usersHandlers.POST : usersHandlers.GET;
    return handler!(ctx);
  }
  if (/^\/users\/[^/]+$/.test(pathname)) return userByIdHandlers.GET!(ctx);
  if (/^\/teams\/[^/]+$/.test(pathname)) return teamByIdHandlers.GET!(ctx);
  return Response.json({ error: "not_found" }, { status: 404 });
}

const transport = { fetch: dispatch };
const base = "http://localhost";

describe("typed client SDK dogfood", () => {
  test("client pinned at current gets the current shape", async () => {
    const client = createClient<DemoApi, Shapes>()({
      baseUrl: base,
      version: "2026-07-21",
      ...transport,
    });
    const user = await client.request("GET /users/:id", { params: { id: "u_1" } });
    expectTypeOf(user).toEqualTypeOf<User>();
    expect(user.firstName).toBe("Ada");
  });

  test("client pinned old gets the derived old wire type", async () => {
    const client = createClient<DemoApi, Shapes>()({
      baseUrl: base,
      version: "2025-06-01",
      apiKey: "key_sdk_dogfood",
      ...transport,
    });
    const user = await client.request("GET /users/:id", { params: { id: "u_1" } });
    // The 2026-05-14 change applies: response is the down() return type.
    expectTypeOf(user).toEqualTypeOf<UserV1 | UserV1[]>();
    expect(user).toMatchObject({ id: "u_1", name: "Ada Lovelace" });
    expect((user as Partial<User>).firstName).toBeUndefined();
  });

  test("old-shape request body is typed and round-trips", async () => {
    const client = createClient<DemoApi, Shapes>()({
      baseUrl: base,
      version: "2025-06-01",
      ...transport,
    });
    const created = await client.request("POST /users", {
      // Typed as the OLD create shape: { name, email } — firstName would error.
      body: { name: "Alan Turing", email: "alan@sdk.example.com" },
    });
    expect(created).toMatchObject({ name: "Alan Turing" });
  });

  test("unchanged routes fall through with their current shape", async () => {
    const client = createClient<DemoApi, Shapes>()({
      baseUrl: base,
      version: "2025-06-01",
      ...transport,
    });
    const team = await client.request("GET /teams/:id", { params: { id: "t_1" } });
    expectTypeOf(team).toEqualTypeOf<Team>();
    expect(team.name).toBe("Compilers");
  });

  test("errors surface with status and body", async () => {
    const client = createClient<DemoApi, Shapes>()({
      baseUrl: base,
      ...transport,
    });
    await expect(
      client.request("GET /users/:id", { params: { id: "nope" } }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
