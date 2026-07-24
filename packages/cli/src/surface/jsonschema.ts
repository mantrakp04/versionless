import { splitNullable } from "./canonical";
import type { Constraints, Field, TypeNode } from "./types";

interface Ctx {
  defs: Record<string, unknown>;
  /** def names currently being resolved — guards recursive $refs */
  visiting: Set<string>;
  /** $defs names that are registered surface models — kept as `{kind:"ref"}`. */
  models?: ReadonlySet<string>;
}

/**
 * Normalize a (subset of) JSON Schema draft 2020-12 into the IR.
 * Local `#/$defs/...` refs are resolved inline — except refs whose def name is
 * in `modelNames`, which stay `{ kind: "ref" }` so nested model usages keep
 * their identity. Recursive refs degrade to `{ kind: "any" }`. Null members of
 * unions are stripped onto `Field.nullable` at the field level; at bare type
 * positions the canonicalizer strips them.
 */
export function fromJsonSchema(
  schema: unknown,
  modelNames?: ReadonlySet<string>,
): TypeNode {
  const ctx: Ctx = { defs: {}, visiting: new Set(), models: modelNames };
  if (typeof schema === "object" && schema !== null) {
    const defs = (schema as Record<string, unknown>)["$defs"];
    if (typeof defs === "object" && defs !== null) {
      ctx.defs = defs as Record<string, unknown>;
    }
  }
  return convert(schema, ctx);
}

function convert(schema: unknown, ctx: Ctx): TypeNode {
  // Boolean schemas: `true` accepts anything, `false` accepts nothing.
  if (schema === true) return { kind: "any" };
  if (schema === false) return { kind: "never" };
  if (typeof schema !== "object" || schema === null) return { kind: "any" };
  const s = schema as Record<string, unknown>;

  // $ref — only local `#/$defs/...` (and self `#`) are supported.
  if (typeof s["$ref"] === "string") {
    return resolveRef(s["$ref"], ctx);
  }

  // const → literal
  if ("const" in s) {
    const value = s["const"];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return { kind: "literal", value };
    }
    return { kind: "any" };
  }

  // enum
  if (Array.isArray(s["enum"])) {
    const values = s["enum"] as unknown[];
    if (values.length === 0) return { kind: "never" };
    if (values.every((v): v is string => typeof v === "string")) {
      return { kind: "string", enum: [...values] };
    }
    const options: TypeNode[] = values.map((v) => {
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        return { kind: "literal", value: v };
      }
      if (v === null) return { kind: "null" };
      return { kind: "any" };
    });
    return maybeUnion(options);
  }

  // anyOf / oneOf → union (null members survive here; the field-level caller
  // strips them via splitNullable, elsewhere the canonicalizer drops them).
  const anyOf = s["anyOf"] ?? s["oneOf"];
  if (Array.isArray(anyOf)) {
    const options = (anyOf as unknown[]).map((member) => convert(member, ctx));
    return withTag(maybeUnion(options));
  }

  // allOf → best-effort merge of object members, else first member.
  if (Array.isArray(s["allOf"])) {
    const members = (s["allOf"] as unknown[]).map((member) =>
      convert(member, ctx),
    );
    if (members.length === 0) return { kind: "any" };
    if (members.every((m) => m.kind === "object")) {
      const fields: Record<string, Field> = {};
      let open: boolean | undefined;
      for (const member of members) {
        if (member.kind !== "object") continue;
        Object.assign(fields, member.fields);
        if (member.open === true) open = true;
      }
      const merged: TypeNode = { kind: "object", fields };
      if (open === true) merged.open = true;
      return merged;
    }
    const first = members[0];
    return first ?? { kind: "any" };
  }

  // type: [...] → union of the individual types (null absorbed like anyOf).
  const type = s["type"];
  if (Array.isArray(type)) {
    const options = (type as unknown[]).map((t) =>
      convert({ ...s, type: t }, ctx),
    );
    return maybeUnion(options);
  }

  if (typeof type === "string") {
    switch (type) {
      case "string": {
        const node: TypeNode = { kind: "string" };
        if (typeof s["format"] === "string") node.format = s["format"];
        return node;
      }
      case "number":
        return { kind: "number" };
      case "integer":
        return { kind: "integer" };
      case "boolean":
        return { kind: "boolean" };
      case "null":
        return { kind: "null" };
      case "array":
        return convertArray(s, ctx);
      case "object":
        return convertObject(s, ctx);
      default:
        return { kind: "any" };
    }
  }

  // No `type` — infer from structural markers, else `any`.
  if ("properties" in s || "required" in s || "additionalProperties" in s) {
    return convertObject(s, ctx);
  }
  if ("items" in s || "prefixItems" in s) {
    return convertArray(s, ctx);
  }
  return { kind: "any" };
}

function resolveRef(ref: string, ctx: Ctx): TypeNode {
  const prefix = "#/$defs/";
  if (ref === "#") {
    // Self reference — always a cycle.
    // TODO: model recursive types properly instead of degrading to any.
    return { kind: "any" };
  }
  if (!ref.startsWith(prefix)) return { kind: "any" };
  const name = decodeURIComponent(ref.slice(prefix.length));
  if (ctx.models?.has(name)) return { kind: "ref", name };
  if (ctx.visiting.has(name)) {
    // Recursive $def — degrade to any.
    // TODO: model recursive types properly instead of degrading to any.
    return { kind: "any" };
  }
  const target = ctx.defs[name];
  if (target === undefined) return { kind: "any" };
  ctx.visiting.add(name);
  try {
    return convert(target, ctx);
  } finally {
    ctx.visiting.delete(name);
  }
}

function convertArray(s: Record<string, unknown>, ctx: Ctx): TypeNode {
  if (Array.isArray(s["prefixItems"])) {
    return {
      kind: "tuple",
      items: (s["prefixItems"] as unknown[]).map((item) => convert(item, ctx)),
    };
  }
  if ("items" in s) {
    return { kind: "array", items: convert(s["items"], ctx) };
  }
  return { kind: "array", items: { kind: "any" } };
}

function convertObject(s: Record<string, unknown>, ctx: Ctx): TypeNode {
  const properties = s["properties"];
  const additional = s["additionalProperties"];
  const hasProperties =
    typeof properties === "object" &&
    properties !== null &&
    Object.keys(properties as Record<string, unknown>).length > 0;

  // `additionalProperties: {schema}` with no properties → record
  if (
    !hasProperties &&
    typeof additional === "object" &&
    additional !== null
  ) {
    return { kind: "record", value: convert(additional, ctx) };
  }

  const required = new Set(
    Array.isArray(s["required"]) ? (s["required"] as string[]) : [],
  );
  const fields: Record<string, Field> = {};
  if (typeof properties === "object" && properties !== null) {
    for (const [key, propSchema] of Object.entries(
      properties as Record<string, unknown>,
    )) {
      const { node, nullable } = splitNullable(convert(propSchema, ctx));
      const field: Field = { type: node };
      if (!required.has(key)) field.optional = true;
      if (nullable) field.nullable = true;
      const constraints = extractConstraints(propSchema);
      if (constraints !== undefined) field.constraints = constraints;
      fields[key] = field;
    }
  }
  const node: TypeNode = { kind: "object", fields };
  // additionalProperties true or absent → open object
  if (additional === undefined || additional === true) node.open = true;
  return node;
}

const CONSTRAINT_KEYS = [
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "multipleOf",
] as const;

function extractConstraints(schema: unknown): Constraints | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const s = schema as Record<string, unknown>;
  const constraints: Constraints = {};
  let found = false;
  for (const key of CONSTRAINT_KEYS) {
    const value = s[key];
    if (key === "pattern") {
      if (typeof value === "string") {
        constraints.pattern = value;
        found = true;
      }
    } else if (typeof value === "number") {
      constraints[key] = value;
      found = true;
    }
  }
  return found ? constraints : undefined;
}

/** Collapse a 0/1-member union and detect a discriminator tag. */
function maybeUnion(options: TypeNode[]): TypeNode {
  if (options.length === 0) return { kind: "never" };
  const single = options.length === 1 ? options[0] : undefined;
  if (single !== undefined) return single;
  return withTag({ kind: "union", options });
}

/**
 * Discriminated union detection: if every option is an object sharing a
 * single literal-valued field with distinct values, record it as `tag`.
 */
function withTag(node: TypeNode): TypeNode {
  if (node.kind !== "union") return node;
  const objects = node.options.filter(
    (option): option is Extract<TypeNode, { kind: "object" }> =>
      option.kind === "object",
  );
  if (objects.length !== node.options.length || objects.length < 2) {
    return node;
  }
  const first = objects[0];
  if (first === undefined) return node;
  candidate: for (const key of Object.keys(first.fields)) {
    const seen = new Set<string>();
    for (const obj of objects) {
      const field = obj.fields[key];
      const value = literalValue(field?.type);
      if (value === undefined) continue candidate;
      const tagKey = JSON.stringify(value);
      if (seen.has(tagKey)) continue candidate;
      seen.add(tagKey);
    }
    node.tag = key;
    return node;
  }
  return node;
}

function literalValue(
  node: TypeNode | undefined,
): string | number | boolean | undefined {
  if (node === undefined) return undefined;
  if (node.kind === "literal") return node.value;
  if (node.kind === "string" && node.enum !== undefined && node.enum.length === 1) {
    return node.enum[0];
  }
  return undefined;
}
