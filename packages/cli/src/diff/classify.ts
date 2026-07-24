export type Polarity = "in" | "out";
export type Severity = "additive" | "neutral" | "warning" | "breaking";

export interface Classification {
  severity: Severity;
  requires: "up" | "down" | null;
}

/**
 * Fine-grained classification keys. Several map onto the same public
 * `DiffEntry.op` (e.g. both `field-added-*` variants render as "field-added").
 */
export type OpKey =
  | "field-removed"
  | "field-added-required"
  | "field-added-optional"
  | "optional-to-required"
  | "required-to-optional"
  | "nullable-added"
  | "nullable-removed"
  | "enum-value-added"
  | "enum-value-removed"
  | "union-option-added"
  | "union-option-removed"
  | "type-changed"
  | "constraint-changed"
  | "endpoint-removed"
  | "endpoint-added";

/** Public op name for a classification key. */
export function opName(key: OpKey): string {
  switch (key) {
    case "field-added-required":
    case "field-added-optional":
      return "field-added";
    case "optional-to-required":
    case "required-to-optional":
      return "optionality-changed";
    case "nullable-added":
    case "nullable-removed":
      return "nullability-changed";
    default:
      return key;
  }
}

/**
 * The classification table. Polarity semantics: "in" = the server reads it
 * (params/query/body/input) — old clients keep SENDING the old shape, so the
 * fix direction is `up`. "out" = the server writes it (responses/output) —
 * old clients keep EXPECTING the old shape, so the fix direction is `down`.
 */
export const classificationTable: Record<
  OpKey,
  Record<Polarity, Classification>
> = {
  "field-removed": {
    in: { severity: "neutral", requires: null }, // server ignores the extra field
    out: { severity: "breaking", requires: "down" }, // old clients still expect it
  },
  "field-added-required": {
    in: { severity: "breaking", requires: "up" }, // old clients don't send it
    out: { severity: "additive", requires: null },
  },
  "field-added-optional": {
    in: { severity: "additive", requires: null },
    out: { severity: "additive", requires: null },
  },
  "optional-to-required": {
    in: { severity: "breaking", requires: "up" },
    out: { severity: "additive", requires: null },
  },
  "required-to-optional": {
    in: { severity: "additive", requires: null },
    out: { severity: "breaking", requires: "down" }, // may now be absent
  },
  "nullable-added": {
    in: { severity: "additive", requires: null },
    out: { severity: "breaking", requires: "down" }, // old clients never saw null
  },
  "nullable-removed": {
    in: { severity: "breaking", requires: "up" }, // old clients may send null
    out: { severity: "additive", requires: null },
  },
  "enum-value-added": {
    in: { severity: "additive", requires: null },
    out: { severity: "warning", requires: null }, // old clients may not handle it
  },
  "enum-value-removed": {
    in: { severity: "breaking", requires: "up" }, // old clients may still send it
    out: { severity: "additive", requires: null },
  },
  "union-option-added": {
    in: { severity: "additive", requires: null },
    out: { severity: "warning", requires: null },
  },
  "union-option-removed": {
    in: { severity: "breaking", requires: "up" },
    out: { severity: "additive", requires: null },
  },
  "type-changed": {
    in: { severity: "breaking", requires: "up" },
    out: { severity: "breaking", requires: "down" },
  },
  "constraint-changed": {
    in: { severity: "warning", requires: null },
    out: { severity: "warning", requires: null },
  },
  "endpoint-removed": {
    in: { severity: "breaking", requires: "down" },
    out: { severity: "breaking", requires: "down" },
  },
  "endpoint-added": {
    in: { severity: "additive", requires: null },
    out: { severity: "additive", requires: null },
  },
};

export function classify(key: OpKey, polarity: Polarity): Classification {
  return classificationTable[key][polarity];
}
