import { fromJsonSchema } from "./jsonschema";
import { fromTypeBox, isTypeBoxSchema } from "./typebox";
import { fromZod, isZodSchema } from "./zod";
import type { TypeNode } from "./types";

export type SchemaConverter = (
  schema: unknown,
  io: "input" | "output",
) => TypeNode;

/** Convert any supported schema value (zod, typebox, or raw JSON Schema). */
export function convertSchema(
  schema: unknown,
  io: "input" | "output",
  modelNames?: ReadonlySet<string>,
): TypeNode {
  if (isZodSchema(schema)) return fromZod(schema, io, modelNames);
  if (isTypeBoxSchema(schema)) return fromTypeBox(schema);
  return fromJsonSchema(schema, modelNames);
}
