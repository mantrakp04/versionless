import type {
  HttpEndpoint,
  Surface,
  TrpcEndpoint,
  TypeNode,
} from "../surface/types";
import type { Polarity } from "./classify";

export interface ReferenceUsage {
  endpoint: string;
  location: string;
  polarity: Polarity;
}

function locationsOf(
  endpoint: HttpEndpoint | TrpcEndpoint,
): { location: string; polarity: Polarity; node: TypeNode | null }[] {
  if (endpoint.transport === "http") {
    return [
      { location: "params", polarity: "in", node: endpoint.params },
      { location: "query", polarity: "in", node: endpoint.query },
      { location: "body", polarity: "in", node: endpoint.body },
      ...Object.keys(endpoint.responses).map((status) => ({
        location: `responses.${status}`,
        polarity: "out" as Polarity,
        node: endpoint.responses[status] ?? null,
      })),
    ];
  }
  return [
    { location: "input", polarity: "in", node: endpoint.input },
    { location: "output", polarity: "out", node: endpoint.output },
  ];
}

function collectRefs(node: TypeNode, into: Set<string>): void {
  switch (node.kind) {
    case "ref":
      into.add(node.name);
      return;
    case "array":
      collectRefs(node.items, into);
      return;
    case "tuple":
      for (const item of node.items) collectRefs(item, into);
      return;
    case "record":
      collectRefs(node.value, into);
      return;
    case "union":
      for (const option of node.options) collectRefs(option, into);
      return;
    case "object":
      for (const field of Object.values(node.fields)) {
        collectRefs(field.type, into);
      }
      return;
    default:
      return;
  }
}

/** Model name to deduped endpoint usage sites across all supplied surfaces. */
export function buildReferenceUsages(
  surfaces: Surface[],
): Map<string, ReferenceUsage[]> {
  const usages = new Map<string, ReferenceUsage[]>();
  const seen = new Set<string>();

  for (const surface of surfaces) {
    for (const [endpointKey, endpoint] of Object.entries(surface.endpoints)) {
      for (const { location, polarity, node } of locationsOf(endpoint)) {
        if (node === null) continue;
        const refs = new Set<string>();
        collectRefs(node, refs);
        for (const name of refs) {
          const dedupeKey = `${name}\0${endpointKey}\0${location}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          const usage = { endpoint: endpointKey, location, polarity };
          const existing = usages.get(name);
          if (existing === undefined) usages.set(name, [usage]);
          else existing.push(usage);
        }
      }
    }
  }

  return usages;
}
