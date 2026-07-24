// TODO: resolve user's zod copy for cross-package publishing — for the spike
// the workspace catalog guarantees exactly one zod 4 copy, so importing our
// own is equivalent.
import { z } from "zod";

import { fromJsonSchema } from "./jsonschema";
import type { TypeNode } from "./types";

/** Structural zod detection: zod 4 `_zod` marker or standard-schema vendor. */
export function isZodSchema(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  if ("_zod" in schema) return true;
  const standard = (schema as { "~standard"?: { vendor?: unknown } })[
    "~standard"
  ];
  return standard?.vendor === "zod";
}

/**
 * Convert a zod schema to the IR by going through zod 4's native
 * `z.toJSONSchema` and normalizing the result.
 *
 * Options verified against installed zod 4.4.3
 * (node_modules/zod/v4/core/json-schema-processors.d.cts):
 *   io: "input" | "output"
 *   unrepresentable: "throw" | "any"
 *   cycles: "ref" | "throw"
 *   reused: "ref" | "inline"
 */
export function fromZod(
  schema: unknown,
  io: "input" | "output",
  modelNames?: ReadonlySet<string>,
): TypeNode {
  const jsonSchema = z.toJSONSchema(schema as z.core.$ZodType, {
    io,
    unrepresentable: "any",
    cycles: "ref",
    reused: "inline",
  });
  return fromJsonSchema(jsonSchema, modelNames);
}

/**
 * Temporarily give each zod model schema a global-registry `id` so
 * `z.toJSONSchema` emits `$ref: "#/$defs/<name>"` wherever the model appears
 * NESTED inside another schema (`z.array(userSchema)`, `z.object({ user })`,
 * ...). Identity matching only sees top-level usages; this is what preserves
 * model attribution everywhere else. Returns a restore function.
 */
export function registerZodModelIds(
  modelNameBySchema: ReadonlyMap<unknown, string>,
): () => void {
  const restores: (() => void)[] = [];
  for (const [schema, name] of modelNameBySchema) {
    if (!isZodSchema(schema)) continue;
    const typed = schema as z.core.$ZodType;
    const prior = z.globalRegistry.get(typed);
    z.globalRegistry.add(typed, { id: name });
    restores.push(() => {
      if (prior !== undefined) z.globalRegistry.add(typed, prior);
      else z.globalRegistry.remove(typed);
    });
  }
  return () => {
    for (const restore of restores) restore();
  };
}
