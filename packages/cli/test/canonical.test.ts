import { describe, expect, test } from "bun:test";

import {
  canonicalize,
  contentHash,
  splitNullable,
  stableStringify,
} from "../src/surface/canonical";
import type { TypeNode } from "../src/surface/types";

describe("canonicalize", () => {
  test("is idempotent", () => {
    const nodes: TypeNode[] = [
      { kind: "string", enum: ["c", "a", "b"] },
      {
        kind: "union",
        options: [
          { kind: "string" },
          { kind: "union", options: [{ kind: "number" }, { kind: "null" }] },
          { kind: "string" },
        ],
      },
      {
        kind: "object",
        fields: {
          a: {
            type: {
              kind: "union",
              options: [{ kind: "string" }, { kind: "null" }],
            },
          },
          b: { type: { kind: "array", items: { kind: "integer" } }, optional: true },
        },
      },
      { kind: "record", value: { kind: "union", options: [{ kind: "null" }] } },
      { kind: "tuple", items: [{ kind: "boolean" }, { kind: "any" }] },
    ];
    for (const node of nodes) {
      const once = canonicalize(node);
      expect(canonicalize(once)).toEqual(once);
    }
  });

  test("flattens nested unions and dedupes options", () => {
    const node: TypeNode = {
      kind: "union",
      options: [
        { kind: "string" },
        {
          kind: "union",
          options: [
            { kind: "number" },
            { kind: "union", options: [{ kind: "string" }, { kind: "boolean" }] },
          ],
        },
        { kind: "number" },
      ],
    };
    const result = canonicalize(node);
    expect(result.kind).toBe("union");
    if (result.kind !== "union") throw new Error("unreachable");
    expect(result.options).toHaveLength(3);
    const kinds = result.options.map((option) => option.kind).sort();
    expect(kinds).toEqual(["boolean", "number", "string"]);
  });

  test("union order is deterministic regardless of input order", () => {
    const a: TypeNode = {
      kind: "union",
      options: [{ kind: "string" }, { kind: "number" }, { kind: "boolean" }],
    };
    const b: TypeNode = {
      kind: "union",
      options: [{ kind: "boolean" }, { kind: "string" }, { kind: "number" }],
    };
    expect(canonicalize(a)).toEqual(canonicalize(b));
    expect(stableStringify(canonicalize(a))).toBe(
      stableStringify(canonicalize(b)),
    );
  });

  test("removes null from unions; null-only union collapses to null", () => {
    const withNull: TypeNode = {
      kind: "union",
      options: [{ kind: "string" }, { kind: "null" }],
    };
    expect(canonicalize(withNull)).toEqual({ kind: "string" });

    const onlyNull: TypeNode = { kind: "union", options: [{ kind: "null" }] };
    expect(canonicalize(onlyNull)).toEqual({ kind: "null" });
  });

  test("single-option union collapses to the option", () => {
    const node: TypeNode = {
      kind: "union",
      options: [{ kind: "integer" }, { kind: "integer" }],
    };
    expect(canonicalize(node)).toEqual({ kind: "integer" });
  });

  test("sorts enum values ascending and dedupes", () => {
    const node: TypeNode = { kind: "string", enum: ["c", "a", "b", "a"] };
    expect(canonicalize(node)).toEqual({
      kind: "string",
      enum: ["a", "b", "c"],
    });
  });

  test("single-value enum collapses to literal", () => {
    const node: TypeNode = { kind: "string", enum: ["only"] };
    expect(canonicalize(node)).toEqual({ kind: "literal", value: "only" });
  });

  test("field nullability moves from union to Field.nullable", () => {
    const node: TypeNode = {
      kind: "object",
      fields: {
        name: {
          type: {
            kind: "union",
            options: [{ kind: "string" }, { kind: "null" }],
          },
        },
      },
    };
    const result = canonicalize(node);
    if (result.kind !== "object") throw new Error("expected object");
    expect(result.fields["name"]).toEqual({
      type: { kind: "string" },
      nullable: true,
    });
  });
});

describe("splitNullable", () => {
  test("splits T | null into node + nullable", () => {
    const { node, nullable } = splitNullable({
      kind: "union",
      options: [{ kind: "string" }, { kind: "null" }],
    });
    expect(nullable).toBe(true);
    expect(node).toEqual({ kind: "string" });
  });

  test("keeps multi-option unions minus null", () => {
    const { node, nullable } = splitNullable({
      kind: "union",
      options: [{ kind: "string" }, { kind: "number" }, { kind: "null" }],
    });
    expect(nullable).toBe(true);
    expect(node).toEqual({
      kind: "union",
      options: [{ kind: "string" }, { kind: "number" }],
    });
  });

  test("null-only input stays null and is nullable", () => {
    expect(splitNullable({ kind: "null" })).toEqual({
      node: { kind: "null" },
      nullable: true,
    });
    expect(
      splitNullable({ kind: "union", options: [{ kind: "null" }] }),
    ).toEqual({ node: { kind: "null" }, nullable: true });
  });

  test("non-nullable types pass through", () => {
    expect(splitNullable({ kind: "boolean" })).toEqual({
      node: { kind: "boolean" },
      nullable: false,
    });
  });
});

describe("stableStringify", () => {
  test("same logical object built in different key orders is byte-identical", () => {
    const a: Record<string, unknown> = {};
    a["zebra"] = 1;
    a["apple"] = { y: [3, 2], x: "v" };
    a["mid"] = null;

    const b: Record<string, unknown> = {};
    b["apple"] = { x: "v", y: [3, 2] };
    b["mid"] = null;
    b["zebra"] = 1;

    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  test("output format: sorted keys, 2-space indent, trailing newline", () => {
    expect(stableStringify({ b: 1, a: [true] })).toBe(
      `{\n  "a": [\n    true\n  ],\n  "b": 1\n}\n`,
    );
    expect(stableStringify({})).toBe("{}\n");
    expect(stableStringify([])).toBe("[]\n");
  });

  test("skips undefined object values", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(
      stableStringify({ a: 1 }),
    );
  });
});

describe("contentHash", () => {
  test("equal for logically-equal nodes, different for different nodes", () => {
    const a: TypeNode = {
      kind: "union",
      options: [{ kind: "string" }, { kind: "number" }],
    };
    const b: TypeNode = {
      kind: "union",
      options: [{ kind: "number" }, { kind: "string" }],
    };
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash({ kind: "string" }));
    expect(contentHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});
