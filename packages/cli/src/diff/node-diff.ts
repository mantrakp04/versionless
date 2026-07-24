import { contentHash } from "../surface/canonical";
import type { Field, TypeNode } from "../surface/types";
import type { Classification, OpKey } from "./classify";
import { renderField, renderType } from "./render";

/** A polarity-independent diff fact; classification happens per usage site. */
export interface RawDiff {
  key: OpKey;
  fieldPath?: string;
  before?: string;
  after?: string;
  /** any↔typed transitions have fixed severity regardless of polarity. */
  override?: Classification;
}

const joinPath = (path: string, key: string): string =>
  path === "" ? key : `${path}.${key}`;

const isAnyish = (node: TypeNode): boolean =>
  node.kind === "any" || node.kind === "unknown";

function push(
  out: RawDiff[],
  key: OpKey,
  path: string,
  extra: Partial<RawDiff> = {},
): void {
  const raw: RawDiff = { key, ...extra };
  if (path !== "") raw.fieldPath = path;
  out.push(raw);
}

function typeChanged(
  out: RawDiff[],
  oldNode: TypeNode,
  newNode: TypeNode,
  path: string,
): void {
  const extra: Partial<RawDiff> = {
    before: renderType(oldNode),
    after: renderType(newNode),
  };
  if (isAnyish(oldNode) && !isAnyish(newNode)) {
    // any → typed: the wire shape was already this, it just got described.
    extra.override = { severity: "neutral", requires: null };
  } else if (!isAnyish(oldNode) && isAnyish(newNode)) {
    // typed → any: coverage lost, not provably breaking.
    extra.override = { severity: "warning", requires: null };
  }
  push(out, "type-changed", path, extra);
}

export function diffNode(
  oldNode: TypeNode,
  newNode: TypeNode,
  path: string,
  out: RawDiff[],
): void {
  if (oldNode.kind === "ref" && newNode.kind === "ref") {
    // Same model: the model-level diff covers it (expanded per usage).
    if (oldNode.name === newNode.name) return;
    typeChanged(out, oldNode, newNode, path);
    return;
  }

  if (oldNode.kind !== newNode.kind) {
    typeChanged(out, oldNode, newNode, path);
    return;
  }

  switch (oldNode.kind) {
    case "string": {
      const newStr = newNode as Extract<TypeNode, { kind: "string" }>;
      const oldEnum = oldNode.enum;
      const newEnum = newStr.enum;
      if (oldEnum !== undefined && newEnum !== undefined) {
        const oldSet = new Set(oldEnum);
        const newSet = new Set(newEnum);
        for (const value of oldEnum) {
          if (!newSet.has(value)) {
            push(out, "enum-value-removed", path, {
              before: JSON.stringify(value),
            });
          }
        }
        for (const value of newEnum) {
          if (!oldSet.has(value)) {
            push(out, "enum-value-added", path, {
              after: JSON.stringify(value),
            });
          }
        }
      } else if (oldEnum !== undefined || newEnum !== undefined) {
        // enum ↔ plain string is a shape change.
        typeChanged(out, oldNode, newNode, path);
      } else if (oldNode.format !== newStr.format) {
        push(out, "constraint-changed", path, {
          before: `string (format: ${oldNode.format ?? "none"})`,
          after: `string (format: ${newStr.format ?? "none"})`,
        });
      }
      return;
    }
    case "literal": {
      const newLit = newNode as Extract<TypeNode, { kind: "literal" }>;
      if (oldNode.value !== newLit.value) {
        typeChanged(out, oldNode, newNode, path);
      }
      return;
    }
    case "array":
      diffNode(
        oldNode.items,
        (newNode as Extract<TypeNode, { kind: "array" }>).items,
        `${path}[]`,
        out,
      );
      return;
    case "tuple": {
      const newTuple = newNode as Extract<TypeNode, { kind: "tuple" }>;
      if (oldNode.items.length !== newTuple.items.length) {
        typeChanged(out, oldNode, newNode, path);
        return;
      }
      for (let i = 0; i < oldNode.items.length; i++) {
        const oldItem = oldNode.items[i];
        const newItem = newTuple.items[i];
        if (oldItem !== undefined && newItem !== undefined) {
          diffNode(oldItem, newItem, `${path}[${i}]`, out);
        }
      }
      return;
    }
    case "record":
      diffNode(
        oldNode.value,
        (newNode as Extract<TypeNode, { kind: "record" }>).value,
        `${path}[*]`,
        out,
      );
      return;
    case "object":
      diffObject(
        oldNode,
        newNode as Extract<TypeNode, { kind: "object" }>,
        path,
        out,
      );
      return;
    case "union":
      diffUnion(
        oldNode,
        newNode as Extract<TypeNode, { kind: "union" }>,
        path,
        out,
      );
      return;
    default:
      // number/integer/boolean/null/any/unknown/never with equal kinds
      return;
  }
}

function constraintsEqual(a: Field, b: Field): boolean {
  return (
    JSON.stringify(sortedConstraints(a)) === JSON.stringify(sortedConstraints(b))
  );
}

function sortedConstraints(field: Field): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const constraints = field.constraints ?? {};
  for (const key of Object.keys(constraints).sort()) {
    out[key] = (constraints as Record<string, unknown>)[key];
  }
  return out;
}

function renderConstraints(field: Field): string {
  const entries = Object.entries(sortedConstraints(field));
  if (entries.length === 0) return "(none)";
  return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
}

function diffObject(
  oldNode: Extract<TypeNode, { kind: "object" }>,
  newNode: Extract<TypeNode, { kind: "object" }>,
  path: string,
  out: RawDiff[],
): void {
  for (const [key, oldField] of Object.entries(oldNode.fields)) {
    const newField = newNode.fields[key];
    const fieldPath = joinPath(path, key);
    if (newField === undefined) {
      push(out, "field-removed", fieldPath, { before: renderField(oldField) });
      continue;
    }
    if (oldField.optional !== newField.optional) {
      push(
        out,
        newField.optional === true ? "required-to-optional" : "optional-to-required",
        fieldPath,
        { before: renderField(oldField), after: renderField(newField) },
      );
    }
    if (oldField.nullable !== newField.nullable) {
      push(
        out,
        newField.nullable === true ? "nullable-added" : "nullable-removed",
        fieldPath,
        { before: renderField(oldField), after: renderField(newField) },
      );
    }
    if (!constraintsEqual(oldField, newField)) {
      push(out, "constraint-changed", fieldPath, {
        before: renderConstraints(oldField),
        after: renderConstraints(newField),
      });
    }
    diffNode(oldField.type, newField.type, fieldPath, out);
  }

  for (const [key, newField] of Object.entries(newNode.fields)) {
    if (oldNode.fields[key] !== undefined) continue;
    push(
      out,
      newField.optional === true ? "field-added-optional" : "field-added-required",
      joinPath(path, key),
      { after: renderField(newField) },
    );
  }
}

function tagValue(option: TypeNode, tag: string): string | undefined {
  if (option.kind !== "object") return undefined;
  const field = option.fields[tag];
  if (field === undefined) return undefined;
  const node = field.type;
  if (node.kind === "literal") return JSON.stringify(node.value);
  if (node.kind === "string" && node.enum !== undefined && node.enum.length === 1) {
    return JSON.stringify(node.enum[0]);
  }
  return undefined;
}

function diffUnion(
  oldNode: Extract<TypeNode, { kind: "union" }>,
  newNode: Extract<TypeNode, { kind: "union" }>,
  path: string,
  out: RawDiff[],
): void {
  // Match structurally-identical options by content hash.
  const oldRemaining = new Map<string, TypeNode>();
  for (const option of oldNode.options) {
    oldRemaining.set(contentHash(option), option);
  }
  const newUnmatched: TypeNode[] = [];
  for (const option of newNode.options) {
    const hash = contentHash(option);
    if (oldRemaining.has(hash)) oldRemaining.delete(hash);
    else newUnmatched.push(option);
  }
  let oldUnmatched = [...oldRemaining.values()];
  let newLeft = newUnmatched;

  // Tag-match when both unions are tagged with the same discriminator.
  if (oldNode.tag !== undefined && oldNode.tag === newNode.tag) {
    const tag = oldNode.tag;
    const byTag = new Map<string, TypeNode>();
    for (const option of oldUnmatched) {
      const value = tagValue(option, tag);
      if (value !== undefined) byTag.set(value, option);
    }
    const stillNew: TypeNode[] = [];
    for (const option of newLeft) {
      const value = tagValue(option, tag);
      const match = value !== undefined ? byTag.get(value) : undefined;
      if (match !== undefined && value !== undefined) {
        byTag.delete(value);
        diffNode(match, option, path, out);
      } else {
        stillNew.push(option);
      }
    }
    oldUnmatched = oldUnmatched.filter((option) => {
      const value = tagValue(option, tag);
      return value === undefined || byTag.has(value);
    });
    newLeft = stillNew;
  }

  // Exactly one removed + one added of the same kind means a refined option.
  const oldSingle = oldUnmatched.length === 1 ? oldUnmatched[0] : undefined;
  const newSingle = newLeft.length === 1 ? newLeft[0] : undefined;
  if (
    oldSingle !== undefined &&
    newSingle !== undefined &&
    oldSingle.kind === newSingle.kind
  ) {
    diffNode(oldSingle, newSingle, path, out);
    return;
  }

  for (const option of oldUnmatched) {
    push(out, "union-option-removed", path, { before: renderType(option) });
  }
  for (const option of newLeft) {
    push(out, "union-option-added", path, { after: renderType(option) });
  }
}
