// GATE B: byte-identical serialization across repeated extractions.
// Importing @versionless/api pulls in @versionless/db → env validation, so the
// skip flag MUST be set before the (dynamic) import below.
process.env.SKIP_ENV_VALIDATION = "1";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { extractSurface, serializeSurface } from "../src/surface/extract";
import type { SurfaceDefinition } from "../src/surface/define";

const { appRouter } = await import("@versionless/api/routers/index");

describe("GATE B: deterministic serialization", () => {
  const userModel = z.object({
    id: z.string(),
    email: z.string().email(),
    age: z.number().nullable(),
  });

  const definition: SurfaceDefinition = {
    trpc: [{ router: appRouter, mount: "/trpc" }],
    models: { User: userModel },
    manual: [
      {
        method: "get",
        path: "/users/:id",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: userModel,
      },
    ],
  };

  test("extract + serialize twice is byte-identical", () => {
    const first = serializeSurface(
      extractSurface(definition, { version: "1.0.0" }),
    );
    const second = serializeSurface(
      extractSurface(definition, { version: "1.0.0" }),
    );
    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
  });

  test("structurally-identical but key-reordered definition yields identical bytes", () => {
    const reordered: SurfaceDefinition = {
      manual: [
        {
          response: userModel,
          params: {
            required: ["id"],
            properties: { id: { type: "string" } },
            type: "object",
          },
          path: "/users/:id",
          method: "get",
        },
      ],
      models: { User: userModel },
      trpc: [{ mount: "/trpc", router: appRouter }],
    };
    const a = serializeSurface(extractSurface(definition, { version: "1.0.0" }));
    const b = serializeSurface(extractSurface(reordered, { version: "1.0.0" }));
    expect(a).toBe(b);
  });

  test("model schemas referenced by identity become refs", () => {
    const surface = extractSurface(definition, { version: "1.0.0" });
    expect(surface.models["User"]?.kind).toBe("object");
    const endpoint = surface.endpoints["GET /users/:id"];
    expect(endpoint).toBeDefined();
    if (endpoint === undefined || endpoint.transport !== "http") {
      throw new Error("expected http endpoint");
    }
    expect(endpoint.responses["200"]).toEqual({ kind: "ref", name: "User" });
    expect(endpoint.params?.kind).toBe("object");
    expect(endpoint.query).toBeNull();
    expect(endpoint.body).toBeNull();
  });

  test("trpc endpoints from the real appRouter are present", () => {
    const surface = extractSurface(definition, { version: "1.0.0" });
    expect(surface.endpoints["trpc:healthCheck"]).toBeDefined();
    expect(surface.endpoints["trpc:healthCheck"]?.transport).toBe("trpc");
  });
});
