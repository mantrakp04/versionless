import type { Field, TypeNode } from "../surface/types";

/** Compact, human-readable rendering of an IR node ("{ id: string, age?: number | null }"). */
export function renderType(node: TypeNode): string {
  switch (node.kind) {
    case "string":
      if (node.enum !== undefined) {
        return node.enum.map((v) => JSON.stringify(v)).join(" | ");
      }
      return "string";
    case "number":
    case "integer":
    case "boolean":
    case "null":
    case "any":
    case "unknown":
    case "never":
      return node.kind;
    case "literal":
      return JSON.stringify(node.value);
    case "array": {
      const inner = renderType(node.items);
      return node.items.kind === "union" ? `(${inner})[]` : `${inner}[]`;
    }
    case "tuple":
      return `[${node.items.map(renderType).join(", ")}]`;
    case "record":
      return `Record<string, ${renderType(node.value)}>`;
    case "union":
      return node.options.map(renderType).join(" | ");
    case "ref":
      return node.name;
    case "object": {
      const entries = Object.entries(node.fields);
      if (entries.length === 0) return "{}";
      const rendered = entries.map(
        ([key, field]) => `${key}${field.optional ? "?" : ""}: ${renderField(field)}`,
      );
      return `{ ${rendered.join(", ")} }`;
    }
  }
}

export function renderField(field: Field): string {
  const base = renderType(field.type);
  return field.nullable ? `${base} | null` : base;
}
