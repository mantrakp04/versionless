export type TypeNode =
  | { kind: "string"; enum?: string[]; format?: string }
  | { kind: "number" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "null" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "any" }
  | { kind: "unknown" }
  | { kind: "never" }
  | { kind: "array"; items: TypeNode }
  | { kind: "tuple"; items: TypeNode[] }
  | { kind: "object"; fields: Record<string, Field>; open?: boolean }
  | { kind: "record"; value: TypeNode }
  | { kind: "union"; options: TypeNode[]; tag?: string }
  | { kind: "ref"; name: string };

export interface Field {
  type: TypeNode;
  optional?: true;
  nullable?: true;
  constraints?: Constraints; // captured, diffed as warnings later
}

export interface Constraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
  multipleOf?: number;
}

export interface HttpEndpoint {
  transport: "http";
  method: string;
  path: string;
  params: TypeNode | null;
  query: TypeNode | null;
  body: TypeNode | null;
  responses: Record<string, TypeNode>;
}

export interface TrpcEndpoint {
  transport: "trpc";
  procedure: string;
  procedureType: "query" | "mutation";
  mount: string;
  input: TypeNode | null;
  output: TypeNode | null;
}

/**
 * Content hash of the snapshot, written by `versionless snapshot` and checked
 * on every read: a hand-edited or corrupted snapshot fails loudly (exit 4)
 * instead of silently skewing `check`'s diff. The hash covers the canonical
 * surface minus `integrity` and `provenance` (both are metadata, not surface).
 */
export interface SurfaceIntegrity {
  algo: "fnv1a-32";
  hash: string;
}

/** CI provenance: which commit produced this snapshot. Populated from GitHub Actions env. */
export interface SurfaceProvenance {
  repo?: string;
  ref?: string;
  sha?: string;
}

/**
 * A registered `v.sunset(...)` entry, carried up from the instance's registry.
 * Applies to every version <= `version`.
 *
 * Deliberately excluded from the integrity hash (see `surfaceHash`): a
 * retirement date is edited after a version ships, and moving it must not make
 * the published contract look rewritten.
 */
export interface SurfaceSunset {
  version: string;
  /** Last day the cohort is served, `YYYY-MM-DD` UTC. */
  after: string;
  message?: string;
}

export interface Surface {
  formatVersion: 1;
  version: string;
  tool: string;
  models: Record<string, TypeNode>;
  endpoints: Record<string, HttpEndpoint | TrpcEndpoint>;
  /** Optional (absent in pre-integrity snapshots — those still load). */
  integrity?: SurfaceIntegrity;
  provenance?: SurfaceProvenance;
  /** Absent when the entry exports no instance, or declares no sunsets. */
  sunsets?: SurfaceSunset[];
}
