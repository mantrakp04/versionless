import type { SchemaConverter } from "./convert";
import type { TrpcEndpoint } from "./types";

/**
 * Walk an oRPC router and produce IR endpoints.
 *
 * Verified against installed @orpc/server 1.14.x:
 * - a router is a plain nested object; a procedure is any value carrying a
 *   `"~orpc"` def with a `handler` function.
 * - the def's `inputSchema` / `outputSchema` are the standard-schema
 *   validators passed to `.input()` / `.output()` (absent when undeclared).
 *
 * Procedure-keyed endpoints share the `trpc:` namespace — the adapter emits
 * `trpc:<path>` telemetry route keys and core indexes `procedures:` changes
 * the same way, so oRPC and tRPC surfaces are interchangeable to the differ.
 */
export function fromOrpcRouter(
  router: unknown,
  mount: string,
  convert: SchemaConverter,
): Record<string, TrpcEndpoint> {
  const endpoints: Record<string, TrpcEndpoint> = {};
  walk(router, [], mount, convert, endpoints);
  return endpoints;
}

interface OrpcDef {
  handler?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

function orpcDef(value: unknown): OrpcDef | null {
  if (typeof value !== "object" || value === null) return null;
  const def = (value as Record<string, unknown>)["~orpc"];
  if (typeof def !== "object" || def === null) return null;
  return def as OrpcDef;
}

function walk(
  node: unknown,
  path: string[],
  mount: string,
  convert: SchemaConverter,
  endpoints: Record<string, TrpcEndpoint>,
): void {
  const def = orpcDef(node);
  if (def !== null && typeof def.handler === "function") {
    const procedure = path.join(".");
    endpoints[`trpc:${procedure}`] = {
      transport: "trpc",
      procedure,
      // oRPC has no query/mutation split; the wire method is transport detail.
      procedureType: "query",
      mount,
      input:
        def.inputSchema === undefined || def.inputSchema === null
          ? null
          : convert(def.inputSchema, "input"),
      output:
        def.outputSchema === undefined || def.outputSchema === null
          ? null
          : convert(def.outputSchema, "output"),
    };
    return;
  }
  if (def !== null) {
    // A lazy router or other oRPC construct we don't understand — loud skip
    // beats a silently missing surface.
    console.warn(
      `[versionless] skipping oRPC node "${path.join(".")}" (unsupported construct — use a plain router object)`,
    );
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    walk(child, [...path, key], mount, convert, endpoints);
  }
}
