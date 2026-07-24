// Nested model references: a registered model keeps its identity (as
// {kind:"ref"}) not only when an endpoint uses the schema object directly,
// but also when it appears NESTED inside another schema — z.array(model),
// z.object({ user: model }), ... — so the differ can attribute field diffs
// to "User.email" everywhere the model appears.
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { extractSurface } from "../src/surface/extract";
import type { SurfaceDefinition } from "../src/surface/define";
import type { TypeNode } from "../src/surface/types";

const userModel = z.object({ id: z.string(), email: z.string() });

function surfaceWith(response: unknown) {
  const definition: SurfaceDefinition = {
    models: { User: userModel },
    manual: [{ method: "get", path: "/users", response }],
  };
  return extractSurface(definition, { version: "2026-01-01" });
}

function response200(surface: ReturnType<typeof surfaceWith>): TypeNode {
  const endpoint = surface.endpoints["GET /users"];
  if (endpoint === undefined || endpoint.transport !== "http") {
    throw new Error("missing endpoint");
  }
  const node = endpoint.responses["200"];
  if (node === undefined) throw new Error("missing response");
  return node;
}

describe("nested model refs", () => {
  test("top-level model usage is a ref (identity match)", () => {
    expect(response200(surfaceWith(userModel))).toEqual({
      kind: "ref",
      name: "User",
    });
  });

  test("array-wrapped model usage is an array of ref", () => {
    expect(response200(surfaceWith(z.array(userModel)))).toEqual({
      kind: "array",
      items: { kind: "ref", name: "User" },
    });
  });

  test("object-nested model usage is a ref field", () => {
    const node = response200(
      surfaceWith(z.object({ user: userModel, total: z.number() })),
    );
    if (node.kind !== "object") throw new Error("expected object");
    expect(node.fields["user"]?.type).toEqual({ kind: "ref", name: "User" });
    expect(node.fields["total"]?.type).toEqual({ kind: "number" });
  });

  test("model bodies stay fully inline (no self- or cross-refs)", () => {
    const surface = surfaceWith(z.array(userModel));
    const model = surface.models["User"];
    if (model === undefined || model.kind !== "object") {
      throw new Error("expected inline object model");
    }
    expect(Object.keys(model.fields).sort()).toEqual(["email", "id"]);
  });

  test("global registry is restored after extraction", () => {
    surfaceWith(z.array(userModel));
    // A second conversion of the same nested schema outside extractSurface
    // must inline it again — the temporary id registration didn't leak.
    expect(z.toJSONSchema(z.array(userModel))).not.toHaveProperty("$defs");
  });

  test("a pre-existing registry id is preserved", () => {
    z.globalRegistry.add(userModel, { id: "ExistingId" });
    try {
      expect(response200(surfaceWith(z.array(userModel)))).toEqual({
        kind: "array",
        items: { kind: "ref", name: "User" },
      });
      expect(z.globalRegistry.get(userModel)).toEqual({ id: "ExistingId" });
    } finally {
      z.globalRegistry.remove(userModel);
    }
  });
});
