import { describe, expect, test } from "bun:test";
import { createClient, VersionlessClientError } from "../src/index";
import type { VersionedApi } from "@versionless/core";

type AnyApi = VersionedApi<any, readonly []>;

function stubTransport(handler: (req: Request) => Response | Promise<Response>) {
  const seen: Request[] = [];
  return {
    seen,
    fetch: async (req: Request) => {
      seen.push(req);
      return handler(req);
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createClient transport", () => {
  test("substitutes params, sets version/apiKey headers, parses JSON", async () => {
    const transport = stubTransport(() => json({ ok: true }));
    const client = createClient<AnyApi, { "GET /users/:id": { response: { ok: boolean } } }>()({
      baseUrl: "http://api.test",
      version: "floor",
      apiKey: "key_1",
      fetch: transport.fetch,
    });
    const result = await client.request("GET /users/:id", {
      params: { id: "u 1" },
      query: { expand: "teams" },
    });
    expect(result).toEqual({ ok: true });
    const req = transport.seen[0]!;
    expect(req.method).toBe("GET");
    expect(new URL(req.url).pathname).toBe("/users/u%201");
    expect(new URL(req.url).searchParams.get("expand")).toBe("teams");
    // "floor" is a type-level pin, not a wire version — no header sent.
    expect(req.headers.get("x-api-version")).toBeNull();
    expect(req.headers.get("x-api-key")).toBe("key_1");
  });

  test("sends the pinned version and a JSON body", async () => {
    const transport = stubTransport(() => json({ id: "u_9" }));
    const client = createClient<AnyApi, { "POST /users": { request: { name: string }; response: { id: string } } }>()({
      baseUrl: "http://api.test",
      version: "2025-01-01",
      fetch: transport.fetch,
    });
    await client.request("POST /users", { body: { name: "Ada" } });
    const req = transport.seen[0]!;
    expect(req.headers.get("x-api-version")).toBe("2025-01-01");
    expect(req.headers.get("content-type")).toBe("application/json");
    expect(await req.json()).toEqual({ name: "Ada" });
  });

  test("versionHeader overrides the default x-api-version header", async () => {
    const transport = stubTransport(() => json({ ok: true }));
    const client = createClient<AnyApi, { "GET /x": { response: unknown } }>()({
      baseUrl: "http://api.test",
      version: "2025-01-01",
      versionHeader: "x-acme-version",
      fetch: transport.fetch,
    });
    await client.request("GET /x");
    const req = transport.seen[0]!;
    expect(req.headers.get("x-acme-version")).toBe("2025-01-01");
    expect(req.headers.get("x-api-version")).toBeNull();
  });

  test("missing params throw before any request is made", async () => {
    const transport = stubTransport(() => json({}));
    const client = createClient<AnyApi, { "GET /users/:id": { response: unknown } }>()({
      baseUrl: "http://api.test",
      fetch: transport.fetch,
    });
    await expect(client.request("GET /users/:id")).rejects.toThrow(/Missing path params/);
    expect(transport.seen).toHaveLength(0);
  });

  test("non-2xx surfaces status and parsed body", async () => {
    const transport = stubTransport(() => json({ error: "nope" }, 404));
    const client = createClient<AnyApi, { "GET /x": { response: unknown } }>()({
      baseUrl: "http://api.test",
      fetch: transport.fetch,
    });
    const err = await client.request("GET /x").catch((e) => e as VersionlessClientError);
    expect(err).toBeInstanceOf(VersionlessClientError);
    expect((err as VersionlessClientError).status).toBe(404);
    expect((err as VersionlessClientError).body).toEqual({ error: "nope" });
  });
});
