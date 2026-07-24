import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { canonicalize } from "../src/surface/canonical";
import { fromZod, isZodSchema } from "../src/surface/zod";

function asObject(node: ReturnType<typeof fromZod>) {
  if (node.kind !== "object") throw new Error(`expected object, got ${node.kind}`);
  return node;
}

describe("isZodSchema", () => {
  test("detects zod 4 schemas structurally", () => {
    expect(isZodSchema(z.string())).toBe(true);
    expect(isZodSchema(z.object({ a: z.number() }))).toBe(true);
    expect(isZodSchema({ type: "string" })).toBe(false);
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema("nope")).toBe(false);
  });
});

describe("fromZod", () => {
  const schema = z.object({
    withDefault: z.string().default("x"),
    nullableNum: z.number().nullable(),
    maybe: z.string().optional(),
  });

  test(".default() field: optional on input io, required on output io", () => {
    const input = asObject(fromZod(schema, "input"));
    const output = asObject(fromZod(schema, "output"));
    expect(input.fields["withDefault"]?.optional).toBe(true);
    expect(output.fields["withDefault"]?.optional).toBeUndefined();
    expect(output.fields["withDefault"]?.type).toEqual({ kind: "string" });
  });

  test("nullable and optional fields", () => {
    const node = asObject(fromZod(schema, "output"));
    expect(node.fields["nullableNum"]).toEqual({
      type: { kind: "number" },
      nullable: true,
    });
    expect(node.fields["maybe"]?.optional).toBe(true);
    expect(node.fields["maybe"]?.type).toEqual({ kind: "string" });
  });

  test("enums", () => {
    const node = canonicalize(fromZod(z.enum(["c", "a", "b"]), "output"));
    expect(node).toEqual({ kind: "string", enum: ["a", "b", "c"] });
  });

  test("single-value enum collapses to literal after canonicalize", () => {
    const node = canonicalize(fromZod(z.enum(["only"]), "output"));
    expect(node).toEqual({ kind: "literal", value: "only" });
  });

  test("unions", () => {
    const node = fromZod(z.union([z.string(), z.number()]), "output");
    expect(node.kind).toBe("union");
    if (node.kind !== "union") throw new Error("unreachable");
    const kinds = node.options.map((option) => option.kind).sort();
    expect(kinds).toEqual(["number", "string"]);
  });

  test("discriminated union: tag detected", () => {
    const du = z.discriminatedUnion("type", [
      z.object({ type: z.literal("circle"), radius: z.number() }),
      z.object({ type: z.literal("square"), side: z.number() }),
    ]);
    const node = fromZod(du, "output");
    expect(node.kind).toBe("union");
    if (node.kind !== "union") throw new Error("unreachable");
    expect(node.tag).toBe("type");
    // Tag survives canonicalization.
    const canonical = canonicalize(node);
    if (canonical.kind !== "union") throw new Error("unreachable");
    expect(canonical.tag).toBe("type");
  });

  test("arrays", () => {
    expect(fromZod(z.array(z.string()), "output")).toEqual({
      kind: "array",
      items: { kind: "string" },
    });
  });

  test("records", () => {
    expect(fromZod(z.record(z.string(), z.number()), "output")).toEqual({
      kind: "record",
      value: { kind: "number" },
    });
  });

  test("nested objects", () => {
    const node = asObject(
      fromZod(
        z.object({ inner: z.object({ deep: z.boolean() }) }),
        "output",
      ),
    );
    const inner = node.fields["inner"]?.type;
    expect(inner?.kind).toBe("object");
    if (inner?.kind !== "object") throw new Error("unreachable");
    expect(inner.fields["deep"]?.type).toEqual({ kind: "boolean" });
  });

  test("z.string().email() captures format", () => {
    const node = asObject(fromZod(z.object({ mail: z.string().email() }), "output"));
    const mail = node.fields["mail"]?.type;
    expect(mail?.kind).toBe("string");
    if (mail?.kind !== "string") throw new Error("unreachable");
    expect(mail.format).toBe("email");
  });

  test("min/max constraints captured on fields", () => {
    const node = asObject(
      fromZod(
        z.object({
          name: z.string().min(2).max(5),
          age: z.number().min(0).max(150),
          tags: z.array(z.string()).min(1).max(10),
        }),
        "output",
      ),
    );
    expect(node.fields["name"]?.constraints).toEqual({
      minLength: 2,
      maxLength: 5,
    });
    expect(node.fields["age"]?.constraints).toEqual({
      minimum: 0,
      maximum: 150,
    });
    expect(node.fields["tags"]?.constraints).toEqual({
      minItems: 1,
      maxItems: 10,
    });
  });

  test("transforms degrade to any on the unrepresentable side", () => {
    const schema = z.string().transform((value) => value.length);
    expect(fromZod(schema, "input")).toEqual({ kind: "string" });
    expect(fromZod(schema, "output")).toEqual({ kind: "any" });
  });
});
