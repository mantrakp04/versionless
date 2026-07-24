import { describe, expect, test } from "bun:test";

import { classificationTable, opName, type OpKey } from "../src/diff/classify";
import { diffSurfaces, type DiffEntry } from "../src/diff/diff";
import type { Field, Surface, TypeNode } from "../src/surface/types";

// ---------------------------------------------------------------------------
// Surface builders

const obj = (fields: Record<string, Field>): TypeNode => ({
  kind: "object",
  fields,
});

/** Model "M" referenced from one in-location (body) and one out-location (responses.200). */
function surfaceWithModel(model: TypeNode): Surface {
  return {
    formatVersion: 1,
    version: "test",
    tool: "test",
    models: { M: model },
    endpoints: {
      "POST /x": {
        transport: "http",
        method: "POST",
        path: "/x",
        params: null,
        query: null,
        body: { kind: "ref", name: "M" },
        responses: { "200": { kind: "ref", name: "M" } },
      },
    },
  };
}

function bare(endpoints: Surface["endpoints"]): Surface {
  return {
    formatVersion: 1,
    version: "test",
    tool: "test",
    models: {},
    endpoints,
  };
}

const findEntries = (
  entries: DiffEntry[],
  op: string,
  polarity: "in" | "out",
): DiffEntry[] => entries.filter((e) => e.op === op && e.polarity === polarity);

// ---------------------------------------------------------------------------
// Table-driven classification coverage: every row of the table gets a pair of
// model shapes exhibiting the op; the model is used once per polarity.

interface Case {
  old: TypeNode;
  new: TypeNode;
  fieldPath: string;
}

const str: Field = { type: { kind: "string" } };
const num: Field = { type: { kind: "number" } };

const CASES: Record<Exclude<OpKey, "endpoint-removed" | "endpoint-added" | "type-changed">, Case> = {
  "field-removed": {
    old: obj({ a: str, b: str }),
    new: obj({ a: str }),
    fieldPath: "b",
  },
  "field-added-required": {
    old: obj({ a: str }),
    new: obj({ a: str, b: num }),
    fieldPath: "b",
  },
  "field-added-optional": {
    old: obj({ a: str }),
    new: obj({ a: str, b: { type: { kind: "number" }, optional: true } }),
    fieldPath: "b",
  },
  "optional-to-required": {
    old: obj({ a: { type: { kind: "string" }, optional: true } }),
    new: obj({ a: str }),
    fieldPath: "a",
  },
  "required-to-optional": {
    old: obj({ a: str }),
    new: obj({ a: { type: { kind: "string" }, optional: true } }),
    fieldPath: "a",
  },
  "nullable-added": {
    old: obj({ a: str }),
    new: obj({ a: { type: { kind: "string" }, nullable: true } }),
    fieldPath: "a",
  },
  "nullable-removed": {
    old: obj({ a: { type: { kind: "string" }, nullable: true } }),
    new: obj({ a: str }),
    fieldPath: "a",
  },
  "enum-value-added": {
    old: obj({ a: { type: { kind: "string", enum: ["x", "y"] } } }),
    new: obj({ a: { type: { kind: "string", enum: ["x", "y", "z"] } } }),
    fieldPath: "a",
  },
  "enum-value-removed": {
    old: obj({ a: { type: { kind: "string", enum: ["x", "y"] } } }),
    new: obj({ a: { type: { kind: "string", enum: ["x"] } } }),
    fieldPath: "a",
  },
  "union-option-added": {
    old: obj({
      a: { type: { kind: "union", options: [{ kind: "string" }, { kind: "number" }] } },
    }),
    new: obj({
      a: {
        type: {
          kind: "union",
          options: [{ kind: "string" }, { kind: "number" }, { kind: "boolean" }],
        },
      },
    }),
    fieldPath: "a",
  },
  "union-option-removed": {
    old: obj({
      a: {
        type: {
          kind: "union",
          options: [{ kind: "string" }, { kind: "number" }, { kind: "boolean" }],
        },
      },
    }),
    new: obj({
      a: { type: { kind: "union", options: [{ kind: "string" }, { kind: "number" }] } },
    }),
    fieldPath: "a",
  },
  "constraint-changed": {
    old: obj({ a: { type: { kind: "string" }, constraints: { minLength: 1 } } }),
    new: obj({ a: { type: { kind: "string" }, constraints: { minLength: 2 } } }),
    fieldPath: "a",
  },
};

describe("classification table", () => {
  for (const [key, testCase] of Object.entries(CASES) as [OpKey, Case][]) {
    test(`${key} classifies per polarity`, () => {
      const entries = diffSurfaces(
        surfaceWithModel(testCase.old),
        surfaceWithModel(testCase.new),
      );
      const op = opName(key);
      for (const polarity of ["in", "out"] as const) {
        const matched = findEntries(entries, op, polarity).filter(
          (e) => e.fieldPath === (CASES as Record<string, Case>)[key]?.fieldPath,
        );
        expect(matched.length).toBe(1);
        const entry = matched[0];
        if (entry === undefined) throw new Error("unreachable");
        const expected = classificationTable[key][polarity];
        expect(entry.severity).toBe(expected.severity);
        expect(entry.requires).toBe(expected.requires);
        expect(entry.model).toBe("M");
        expect(entry.endpoint).toBe("POST /x");
        expect(entry.location).toBe(polarity === "in" ? "body" : "responses.200");
      }
    });
  }

  test("type-changed classifies per polarity (string → number)", () => {
    const entries = diffSurfaces(
      surfaceWithModel(obj({ a: str })),
      surfaceWithModel(obj({ a: num })),
    );
    const inEntry = findEntries(entries, "type-changed", "in")[0];
    const outEntry = findEntries(entries, "type-changed", "out")[0];
    expect(inEntry).toMatchObject({
      severity: "breaking",
      requires: "up",
      before: "string",
      after: "number",
      fieldPath: "a",
    });
    expect(outEntry).toMatchObject({ severity: "breaking", requires: "down" });
  });

  test("endpoint-removed and endpoint-added", () => {
    const oldS = bare({
      "GET /a": {
        transport: "http",
        method: "GET",
        path: "/a",
        params: null,
        query: null,
        body: null,
        responses: {},
      },
    });
    const newS = bare({
      "GET /b": {
        transport: "http",
        method: "GET",
        path: "/b",
        params: null,
        query: null,
        body: null,
        responses: {},
      },
    });
    const entries = diffSurfaces(oldS, newS);
    expect(entries).toHaveLength(2);
    const removed = entries.find((e) => e.op === "endpoint-removed");
    const added = entries.find((e) => e.op === "endpoint-added");
    expect(removed).toMatchObject({
      endpoint: "GET /a",
      severity: "breaking",
      requires: "down",
    });
    expect(added).toMatchObject({
      endpoint: "GET /b",
      severity: "additive",
      requires: null,
    });
  });
});

describe("diff mechanics", () => {
  test("union options match by content hash regardless of order", () => {
    const optionsA: TypeNode[] = [
      { kind: "string" },
      obj({ x: num }),
      { kind: "boolean" },
    ];
    const optionsB: TypeNode[] = [
      obj({ x: num }),
      { kind: "boolean" },
      { kind: "string" },
    ];
    const entries = diffSurfaces(
      surfaceWithModel(obj({ u: { type: { kind: "union", options: optionsA } } })),
      surfaceWithModel(obj({ u: { type: { kind: "union", options: optionsB } } })),
    );
    expect(entries).toHaveLength(0);
  });

  test("one union option removed + one added of the same kind recurses into the pair", () => {
    const oldUnion: TypeNode = {
      kind: "union",
      options: [{ kind: "string" }, obj({ x: num, y: str })],
    };
    const newUnion: TypeNode = {
      kind: "union",
      options: [{ kind: "string" }, obj({ x: num })],
    };
    const entries = diffSurfaces(
      surfaceWithModel(obj({ u: { type: oldUnion } })),
      surfaceWithModel(obj({ u: { type: newUnion } })),
    );
    // Recursed: the object option lost field y → field-removed at u.y, not union-option-removed.
    expect(entries.every((e) => e.op === "field-removed")).toBe(true);
    expect(entries.some((e) => e.fieldPath === "u.y")).toBe(true);
  });

  test("tagged unions match options by discriminator", () => {
    const oldUnion: TypeNode = {
      kind: "union",
      tag: "type",
      options: [
        obj({ type: { type: { kind: "literal", value: "a" } }, v: str }),
        obj({ type: { type: { kind: "literal", value: "b" } }, v: str }),
      ],
    };
    const newUnion: TypeNode = {
      kind: "union",
      tag: "type",
      options: [
        obj({ type: { type: { kind: "literal", value: "a" } }, v: num }), // v: string → number
        obj({ type: { type: { kind: "literal", value: "b" } }, v: str }),
      ],
    };
    const entries = diffSurfaces(
      surfaceWithModel(obj({ u: { type: oldUnion } })),
      surfaceWithModel(obj({ u: { type: newUnion } })),
    );
    const typeChanges = entries.filter((e) => e.op === "type-changed");
    expect(typeChanges.length).toBeGreaterThan(0);
    expect(typeChanges.every((e) => e.fieldPath === "u.v")).toBe(true);
  });

  test("a model referenced by two endpoints yields one entry per endpoint", () => {
    const make = (model: TypeNode): Surface => ({
      formatVersion: 1,
      version: "test",
      tool: "test",
      models: { User: model },
      endpoints: {
        "GET /users/:id": {
          transport: "http",
          method: "GET",
          path: "/users/:id",
          params: null,
          query: null,
          body: null,
          responses: { "200": { kind: "ref", name: "User" } },
        },
        "trpc:user.get": {
          transport: "trpc",
          procedure: "user.get",
          procedureType: "query",
          mount: "/trpc",
          input: null,
          output: { kind: "ref", name: "User" },
        },
      },
    });
    const entries = diffSurfaces(
      make(obj({ id: str, name: str })),
      make(obj({ id: str })),
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.endpoint).sort()).toEqual([
      "GET /users/:id",
      "trpc:user.get",
    ]);
    expect(
      entries.every(
        (e) =>
          e.op === "field-removed" &&
          e.model === "User" &&
          e.fieldPath === "name" &&
          e.severity === "breaking" &&
          e.requires === "down",
      ),
    ).toBe(true);
    expect(entries.map((e) => e.location).sort()).toEqual([
      "output",
      "responses.200",
    ]);
  });

  test("nested field paths use dots and [] for arrays", () => {
    const make = (price: Field): TypeNode =>
      obj({
        items: {
          type: { kind: "array", items: obj({ price }) },
        },
      });
    const entries = diffSurfaces(
      surfaceWithModel(make(num)),
      surfaceWithModel(make(str)),
    );
    expect(entries.some((e) => e.fieldPath === "items[].price")).toBe(true);
  });

  test("any → typed is neutral, typed → any is a warning", () => {
    const anyField: Field = { type: { kind: "any" } };
    const toTyped = diffSurfaces(
      surfaceWithModel(obj({ a: anyField })),
      surfaceWithModel(obj({ a: str })),
    );
    expect(toTyped.every((e) => e.severity === "neutral" && e.requires === null)).toBe(true);
    const toAny = diffSurfaces(
      surfaceWithModel(obj({ a: str })),
      surfaceWithModel(obj({ a: anyField })),
    );
    expect(toAny.every((e) => e.severity === "warning" && e.requires === null)).toBe(true);
  });

  test("a location gaining a schema is neutral (any → typed)", () => {
    const without = bare({
      "POST /x": {
        transport: "http",
        method: "POST",
        path: "/x",
        params: null,
        query: null,
        body: null,
        responses: {},
      },
    });
    const withBody = bare({
      "POST /x": {
        transport: "http",
        method: "POST",
        path: "/x",
        params: null,
        query: null,
        body: obj({ a: str }),
        responses: {},
      },
    });
    const entries = diffSurfaces(without, withBody);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      op: "type-changed",
      severity: "neutral",
      location: "body",
      endpoint: "POST /x",
    });
  });

  test("same-name refs produce no endpoint-level entries (model diff covers them)", () => {
    const entries = diffSurfaces(
      surfaceWithModel(obj({ a: str })),
      surfaceWithModel(obj({ a: str })),
    );
    expect(entries).toHaveLength(0);
  });
});
