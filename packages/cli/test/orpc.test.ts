import { describe, expect, test } from "bun:test";
import { os } from "@orpc/server";
import { z } from "zod";

import { extractSurface } from "../src/surface/extract";

const userSchema = z.object({ id: z.string(), firstName: z.string() });

const router = {
  demo: {
    userList: os.output(z.array(userSchema)).handler(() => []),
    userCreate: os
      .input(z.object({ firstName: z.string() }))
      .output(userSchema)
      .handler(({ input }) => ({ id: "u_1", ...input })),
    noSchemas: os.handler(() => "ok"),
  },
};

describe("oRPC surface extraction", () => {
  const surface = extractSurface(
    { orpc: [{ router }], models: { User: userSchema } },
    { version: "2026-01-01" },
  );

  test("procedures are keyed in the trpc: namespace by dotted path", () => {
    expect(Object.keys(surface.endpoints).sort()).toEqual([
      "trpc:demo.noSchemas",
      "trpc:demo.userCreate",
      "trpc:demo.userList",
    ]);
  });

  test("input/output schemas convert, with nested model refs", () => {
    const create = surface.endpoints["trpc:demo.userCreate"];
    if (create?.transport !== "trpc") throw new Error("expected trpc endpoint");
    expect(create.output).toEqual({ kind: "ref", name: "User" });
    expect(create.input?.kind).toBe("object");

    const list = surface.endpoints["trpc:demo.userList"];
    if (list?.transport !== "trpc") throw new Error("expected trpc endpoint");
    expect(list.output).toEqual({
      kind: "array",
      items: { kind: "ref", name: "User" },
    });
    expect(list.input).toBeNull();
  });

  test("undeclared schemas extract as null (any)", () => {
    const bare = surface.endpoints["trpc:demo.noSchemas"];
    if (bare?.transport !== "trpc") throw new Error("expected trpc endpoint");
    expect(bare.input).toBeNull();
    expect(bare.output).toBeNull();
  });
});
