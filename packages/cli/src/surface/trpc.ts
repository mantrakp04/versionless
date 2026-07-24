import { convertSchema } from "./convert";
import type { SchemaConverter } from "./convert";
import type { Field, TrpcEndpoint, TypeNode } from "./types";

export type { SchemaConverter } from "./convert";

/**
 * Walk a tRPC v11 router and produce IR endpoints.
 *
 * Verified against installed @trpc/server 11.18.0:
 * - `router._def.procedures` is a flat record keyed by dotted path at runtime
 *   (dist/tracked-*.mjs joins nested keys with ".").
 * - each procedure's `_def` has `type: "query" | "mutation" | "subscription"`,
 *   `inputs: Parser[]`, and (from the builder def) `output?: Parser`.
 */
export function fromTrpcRouter(
  router: unknown,
  mount: string,
  convert: SchemaConverter = convertSchema,
): Record<string, TrpcEndpoint> {
  const endpoints: Record<string, TrpcEndpoint> = {};
  const def = (router as { _def?: { procedures?: unknown } } | null | undefined)
    ?._def;
  const procedures = def?.procedures;
  if (typeof procedures !== "object" || procedures === null) return endpoints;

  for (const [path, procedure] of Object.entries(
    procedures as Record<string, unknown>,
  )) {
    const procDef = (
      procedure as
        | { _def?: { type?: unknown; inputs?: unknown; output?: unknown } }
        | null
        | undefined
    )?._def;
    const type = procDef?.type;
    if (type === "subscription") {
      console.warn(
        `[versionless] skipping subscription procedure "${path}" (not supported in spike)`,
      );
      continue;
    }
    if (type !== "query" && type !== "mutation") continue;

    const rawInputs = Array.isArray(procDef?.inputs) ? procDef.inputs : [];
    const inputNodes = rawInputs.map((parser) => convert(parser, "input"));
    const input = mergeInputs(inputNodes);
    const output =
      procDef?.output !== undefined && procDef.output !== null
        ? convert(procDef.output, "output")
        : null;

    endpoints[`trpc:${path}`] = {
      transport: "trpc",
      procedure: path,
      procedureType: type,
      mount,
      input,
      output,
    };
  }
  return endpoints;
}

/** Merge multiple `.input()` calls: object results merge fields, else last wins. */
function mergeInputs(nodes: TypeNode[]): TypeNode | null {
  if (nodes.length === 0) return null;
  const single = nodes.length === 1 ? nodes[0] : undefined;
  if (single !== undefined) return single;
  if (nodes.every((node) => node.kind === "object")) {
    const fields: Record<string, Field> = {};
    let open: boolean | undefined;
    for (const node of nodes) {
      if (node.kind !== "object") continue;
      Object.assign(fields, node.fields);
      if (node.open === true) open = true;
    }
    const merged: TypeNode = { kind: "object", fields };
    if (open === true) merged.open = true;
    return merged;
  }
  return nodes[nodes.length - 1] ?? null;
}
