import type { Field, TypeNode } from "./types";

/**
 * JSON stringify with all object keys sorted recursively, 2-space indent,
 * trailing newline. Deterministic byte output for logically-equal values.
 */
export function stableStringify(value: unknown): string {
  return `${stringify(value, "")}\n`;
}

function stringify(value: unknown, indent: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      // undefined / function / symbol at the top level — mirror JSON.stringify
      // by serializing as null (inside objects they are skipped below).
      return "null";
  }
  const childIndent = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map(
      (item) => `${childIndent}${stringify(item, childIndent)}`,
    );
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  if (keys.length === 0) return "{}";
  const entries = keys.map(
    (key) =>
      `${childIndent}${JSON.stringify(key)}: ${stringify(obj[key], childIndent)}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

/** FNV-1a 32-bit hash, hex-encoded. No dependencies. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Hash of a node that is already in canonical form. */
function hashCanonical(node: TypeNode): string {
  return fnv1a(stableStringify(node));
}

/** Short content hash of the canonical form of a node. */
export function contentHash(node: TypeNode): string {
  return hashCanonical(canonicalize(node));
}

/**
 * Split null-ness off a type node: `T | null` becomes `{ node: T, nullable: true }`.
 * Used at the field level; `Field.nullable` is where null-ness lives in the IR.
 */
export function splitNullable(node: TypeNode): {
  node: TypeNode;
  nullable: boolean;
} {
  if (node.kind === "null") {
    return { node: { kind: "null" }, nullable: true };
  }
  if (node.kind === "union") {
    const nonNull = node.options.filter((option) => option.kind !== "null");
    const nullable = nonNull.length !== node.options.length;
    if (!nullable) return { node, nullable: false };
    if (nonNull.length === 0) return { node: { kind: "null" }, nullable: true };
    if (nonNull.length === 1) {
      const only = nonNull[0];
      if (only === undefined) throw new Error("unreachable");
      return { node: only, nullable: true };
    }
    const union: TypeNode = { kind: "union", options: nonNull };
    if (node.tag !== undefined) union.tag = node.tag;
    return { node: union, nullable: true };
  }
  return { node, nullable: false };
}

/**
 * Idempotent normal form:
 * - unions are flattened, deduped (by content hash), null-free, and sorted by hash
 * - a union that contained only null collapses to `{ kind: "null" }`
 * - a union with a single remaining option collapses to that option
 * - enum values are sorted ascending; a single-value enum becomes a literal
 * - object field keys are left in place (the stringifier sorts keys)
 */
export function canonicalize(node: TypeNode): TypeNode {
  switch (node.kind) {
    case "string": {
      if (node.enum === undefined) return copyString(node);
      const values = [...new Set(node.enum)].sort();
      const single = values.length === 1 ? values[0] : undefined;
      if (single !== undefined) return { kind: "literal", value: single };
      const result = copyString(node);
      result.enum = values;
      return result;
    }
    case "array":
      return { kind: "array", items: canonicalize(node.items) };
    case "tuple":
      return { kind: "tuple", items: node.items.map(canonicalize) };
    case "object": {
      const fields: Record<string, Field> = {};
      for (const [key, field] of Object.entries(node.fields)) {
        fields[key] = canonicalizeField(field);
      }
      const result: TypeNode = { kind: "object", fields };
      if (node.open === true) result.open = true;
      return result;
    }
    case "record":
      return { kind: "record", value: canonicalize(node.value) };
    case "union": {
      // Flatten nested unions, canonicalize members, drop nulls.
      const flat: TypeNode[] = [];
      const flatten = (options: TypeNode[]): void => {
        for (const option of options) {
          const canonical = canonicalize(option);
          if (canonical.kind === "union") flatten(canonical.options);
          else if (canonical.kind !== "null") flat.push(canonical);
        }
      };
      flatten(node.options);
      if (flat.length === 0) return { kind: "null" };
      // Dedupe by canonical hash, then sort by hash for a deterministic order.
      const byHash = new Map<string, TypeNode>();
      for (const option of flat) {
        const hash = hashCanonical(option);
        if (!byHash.has(hash)) byHash.set(hash, option);
      }
      const options = [...byHash.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, option]) => option);
      const single = options.length === 1 ? options[0] : undefined;
      if (single !== undefined) return single;
      const result: TypeNode = { kind: "union", options };
      if (node.tag !== undefined) result.tag = node.tag;
      return result;
    }
    case "literal":
      return { kind: "literal", value: node.value };
    case "ref":
      return { kind: "ref", name: node.name };
    default:
      return { kind: node.kind };
  }
}

function copyString(node: { kind: "string"; enum?: string[]; format?: string }): {
  kind: "string";
  enum?: string[];
  format?: string;
} {
  const result: { kind: "string"; enum?: string[]; format?: string } = {
    kind: "string",
  };
  if (node.format !== undefined) result.format = node.format;
  return result;
}

function canonicalizeField(field: Field): Field {
  // Split null-ness off BEFORE canonicalizing: canonicalize drops null
  // options from unions, so detection must happen on the raw node.
  const { node, nullable } = splitNullable(field.type);
  const result: Field = { type: canonicalize(node) };
  if (field.optional === true) result.optional = true;
  if (field.nullable === true || nullable) result.nullable = true;
  if (field.constraints !== undefined && Object.keys(field.constraints).length > 0) {
    result.constraints = { ...field.constraints };
  }
  return result;
}
