import { fromJsonSchema } from "./jsonschema";
import type { TypeNode } from "./types";

const TYPEBOX_KIND = Symbol.for("TypeBox.Kind");

/** TypeBox schemas are plain JSON Schema objects tagged with a well-known symbol. */
export function isTypeBoxSchema(schema: unknown): boolean {
  return (
    typeof schema === "object" && schema !== null && TYPEBOX_KIND in schema
  );
}

/**
 * Deep-copy keeping only string-keyed, JSON-representable values. TypeBox
 * tags its schemas (and nested sub-schemas) with symbol keys; everything else
 * is already JSON Schema.
 */
function stripSymbols(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSymbols);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "function") continue;
      out[key] = stripSymbols(child);
    }
    return out;
  }
  return value;
}

/** Convert a TypeBox schema to the IR by treating it as JSON Schema. */
export function fromTypeBox(schema: unknown): TypeNode {
  return fromJsonSchema(stripSymbols(schema));
}
