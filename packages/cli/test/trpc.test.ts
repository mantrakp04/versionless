import { describe, expect, test } from "bun:test";
import { initTRPC } from "@trpc/server";
import { z } from "zod";

import { fromTrpcRouter } from "../src/surface/trpc";

const t = initTRPC.create();

const appRouter = t.router({
  list: t.procedure
    .input(z.object({ limit: z.number() }))
    .output(z.array(z.string()))
    .query(() => []),
  create: t.procedure
    .input(z.object({ name: z.string() }))
    .mutation(() => undefined),
  user: t.router({
    get: t.procedure
      .input(z.object({ id: z.string() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .query(({ input }) => ({ id: input.id, name: "n" })),
  }),
});

describe("fromTrpcRouter", () => {
  const endpoints = fromTrpcRouter(appRouter, "/trpc");

  test("emits one endpoint per procedure with trpc: keys, nested paths dotted", () => {
    expect(Object.keys(endpoints).sort()).toEqual([
      "trpc:create",
      "trpc:list",
      "trpc:user.get",
    ]);
  });

  test("query with input and output", () => {
    const list = endpoints["trpc:list"];
    expect(list).toBeDefined();
    if (list === undefined) throw new Error("unreachable");
    expect(list.transport).toBe("trpc");
    expect(list.procedure).toBe("list");
    expect(list.procedureType).toBe("query");
    expect(list.mount).toBe("/trpc");
    expect(list.input?.kind).toBe("object");
    if (list.input?.kind !== "object") throw new Error("unreachable");
    expect(list.input.fields["limit"]?.type).toEqual({ kind: "number" });
    expect(list.output).toEqual({ kind: "array", items: { kind: "string" } });
  });

  test("mutation with input and no output", () => {
    const create = endpoints["trpc:create"];
    expect(create).toBeDefined();
    if (create === undefined) throw new Error("unreachable");
    expect(create.procedureType).toBe("mutation");
    expect(create.input?.kind).toBe("object");
    expect(create.output).toBeNull();
  });

  test("nested router procedure", () => {
    const get = endpoints["trpc:user.get"];
    expect(get).toBeDefined();
    if (get === undefined) throw new Error("unreachable");
    expect(get.procedure).toBe("user.get");
    expect(get.procedureType).toBe("query");
    expect(get.output?.kind).toBe("object");
    if (get.output?.kind !== "object") throw new Error("unreachable");
    expect(Object.keys(get.output.fields).sort()).toEqual(["id", "name"]);
  });

  test("procedure without any input has input: null", () => {
    const bare = t.router({
      ping: t.procedure.query(() => "pong"),
    });
    const extracted = fromTrpcRouter(bare, "/trpc");
    expect(extracted["trpc:ping"]?.input).toBeNull();
    expect(extracted["trpc:ping"]?.output).toBeNull();
  });

  test("non-router input returns no endpoints", () => {
    expect(fromTrpcRouter(null, "/trpc")).toEqual({});
    expect(fromTrpcRouter({}, "/trpc")).toEqual({});
  });
});
