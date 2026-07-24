import { describe, expect, test } from "bun:test";
import { Elysia, t } from "elysia";
import { z } from "zod";

import { defineSurface } from "../src/surface/define";
import { extractSurface, serializeSurface } from "../src/surface/extract";
import { fromTypeBox, isTypeBoxSchema } from "../src/surface/typebox";
import type { HttpEndpoint, TypeNode } from "../src/surface/types";

describe("typebox", () => {
  test("detects TypeBox schemas via the well-known symbol", () => {
    expect(isTypeBoxSchema(t.Object({ id: t.String() }))).toBe(true);
    expect(isTypeBoxSchema({ type: "object" })).toBe(false);
    expect(isTypeBoxSchema(z.object({}))).toBe(false);
    expect(isTypeBoxSchema(null)).toBe(false);
  });

  test("converts through JSON Schema", () => {
    const node = fromTypeBox(
      t.Object({
        id: t.String(),
        count: t.Optional(t.Number()),
        tags: t.Array(t.String()),
      }),
    );
    expect(node).toEqual({
      kind: "object",
      fields: {
        id: { type: { kind: "string" } },
        count: { type: { kind: "number" }, optional: true },
        tags: { type: { kind: "array", items: { kind: "string" } } },
      },
      open: true,
    });
  });
});

describe("elysia extraction", () => {
  const User = t.Object({
    id: t.String(),
    age: t.Nullable(t.Number()),
  });

  const app = new Elysia()
    .get("/users/:id", () => ({ id: "1", age: null }), {
      params: t.Object({ id: t.String() }),
      response: User, // bare schema → normalized to { 200: ... }
    })
    .post("/users", () => ({ id: "1", age: null }) as never, {
      body: z.object({ email: z.string() }), // zod route (Standard Schema)
      response: { 200: User, 404: t.Object({ error: t.String() }) },
    })
    .get("/health", () => "ok"); // schema-less route

  const definition = defineSurface({
    elysia: [app],
    models: { User },
  });

  const surface = extractSurface(definition, { version: "2026-01-01" });

  test("records every route, including schema-less ones", () => {
    expect(Object.keys(surface.endpoints).sort()).toEqual([
      "GET /health",
      "GET /users/:id",
      "POST /users",
    ]);
  });

  test("typebox params + bare response referencing a model", () => {
    const endpoint = surface.endpoints["GET /users/:id"] as HttpEndpoint;
    expect(endpoint.transport).toBe("http");
    expect(endpoint.params).toEqual({
      kind: "object",
      fields: { id: { type: { kind: "string" } } },
      open: true,
    });
    expect(endpoint.query).toBeNull();
    expect(endpoint.body).toBeNull();
    expect(endpoint.responses).toEqual({ "200": { kind: "ref", name: "User" } });
  });

  test("zod body and status-map responses", () => {
    const endpoint = surface.endpoints["POST /users"] as HttpEndpoint;
    expect(endpoint.body).toEqual({
      kind: "object",
      fields: { email: { type: { kind: "string" } } },
      open: true,
    });
    expect(endpoint.responses["200"]).toEqual({ kind: "ref", name: "User" });
    expect(endpoint.responses["404"]).toEqual({
      kind: "object",
      fields: { error: { type: { kind: "string" } } },
      open: true,
    });
  });

  test("schema-less route gets null bodies and no responses", () => {
    const endpoint = surface.endpoints["GET /health"] as HttpEndpoint;
    expect(endpoint.params).toBeNull();
    expect(endpoint.query).toBeNull();
    expect(endpoint.body).toBeNull();
    expect(endpoint.responses).toEqual({});
  });

  test("typebox model normalizes nullability onto fields", () => {
    const model = surface.models["User"] as Extract<
      TypeNode,
      { kind: "object" }
    >;
    expect(model.fields["age"]).toEqual({
      type: { kind: "number" },
      nullable: true,
    });
  });

  test("extraction is deterministic", () => {
    const again = extractSurface(definition, { version: "2026-01-01" });
    expect(serializeSurface(again)).toBe(serializeSurface(surface));
  });
});
