import type {
  HttpEndpoint,
  Surface,
  TrpcEndpoint,
  TypeNode,
} from "../surface/types";
import {
  classify,
  opName,
  type Polarity,
  type Severity,
} from "./classify";
import { diffNode, type RawDiff } from "./node-diff";
import {
  buildReferenceUsages,
  type ReferenceUsage,
} from "./reference-usages";

export interface DiffEntry {
  op: string;
  severity: Severity;
  /** Set when the diff is rooted in a named model ("User"). */
  model?: string;
  /** Canonical endpoint key — one entry PER affected endpoint. */
  endpoint: string;
  /** "responses.200" | "body" | "input" | "output" | "params" | "query" | "endpoint" */
  location: string;
  polarity: Polarity;
  /** "name", "address.city", "items[].price" */
  fieldPath?: string;
  before?: string;
  after?: string;
  requires: "up" | "down" | null;
}

const NULL_AS_ANY: TypeNode = { kind: "any" };

interface EndpointLocation {
  location: string;
  polarity: Polarity;
  oldNode: TypeNode | null;
  newNode: TypeNode | null;
}

function endpointLocations(
  oldEndpoint: HttpEndpoint | TrpcEndpoint,
  newEndpoint: HttpEndpoint | TrpcEndpoint,
): EndpointLocation[] {
  if (oldEndpoint.transport === "http" && newEndpoint.transport === "http") {
    const locations: EndpointLocation[] = [
      {
        location: "params",
        polarity: "in",
        oldNode: oldEndpoint.params,
        newNode: newEndpoint.params,
      },
      {
        location: "query",
        polarity: "in",
        oldNode: oldEndpoint.query,
        newNode: newEndpoint.query,
      },
      {
        location: "body",
        polarity: "in",
        oldNode: oldEndpoint.body,
        newNode: newEndpoint.body,
      },
    ];
    const statuses = new Set([
      ...Object.keys(oldEndpoint.responses),
      ...Object.keys(newEndpoint.responses),
    ]);
    for (const status of [...statuses].sort()) {
      locations.push({
        location: `responses.${status}`,
        polarity: "out",
        oldNode: oldEndpoint.responses[status] ?? null,
        newNode: newEndpoint.responses[status] ?? null,
      });
    }
    return locations;
  }

  if (oldEndpoint.transport === "trpc" && newEndpoint.transport === "trpc") {
    return [
      {
        location: "input",
        polarity: "in",
        oldNode: oldEndpoint.input,
        newNode: newEndpoint.input,
      },
      {
        location: "output",
        polarity: "out",
        oldNode: oldEndpoint.output,
        newNode: newEndpoint.output,
      },
    ];
  }

  return [];
}

function finish(
  raw: RawDiff,
  usage: ReferenceUsage,
  model?: string,
): DiffEntry {
  const classification = raw.override ?? classify(raw.key, usage.polarity);
  const entry: DiffEntry = {
    op: opName(raw.key),
    severity: classification.severity,
    endpoint: usage.endpoint,
    location: usage.location,
    polarity: usage.polarity,
    requires: classification.requires,
  };
  if (model !== undefined) entry.model = model;
  if (raw.fieldPath !== undefined) entry.fieldPath = raw.fieldPath;
  if (raw.before !== undefined) entry.before = raw.before;
  if (raw.after !== undefined) entry.after = raw.after;
  return entry;
}

export function diffSurfaces(oldSurface: Surface, newSurface: Surface): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const usages = buildReferenceUsages([oldSurface, newSurface]);

  // Compare named models once, then expand each fact to its endpoint usage sites.
  for (const [name, oldModel] of Object.entries(oldSurface.models)) {
    const newModel = newSurface.models[name];
    if (newModel === undefined) continue;
    const rawDiffs: RawDiff[] = [];
    diffNode(oldModel, newModel, "", rawDiffs);
    const sites = usages.get(name) ?? [];
    for (const raw of rawDiffs) {
      for (const usage of sites) {
        entries.push(finish(raw, usage, name));
      }
    }
  }

  // Compare endpoints by canonical key.
  const endpointKeys = new Set([
    ...Object.keys(oldSurface.endpoints),
    ...Object.keys(newSurface.endpoints),
  ]);
  for (const endpointKey of [...endpointKeys].sort()) {
    const oldEndpoint = oldSurface.endpoints[endpointKey];
    const newEndpoint = newSurface.endpoints[endpointKey];
    if (oldEndpoint !== undefined && newEndpoint === undefined) {
      entries.push(
        finish(
          { key: "endpoint-removed" },
          {
            endpoint: endpointKey,
            location: "endpoint",
            polarity: "out",
          },
        ),
      );
      continue;
    }
    if (oldEndpoint === undefined && newEndpoint !== undefined) {
      entries.push(
        finish(
          { key: "endpoint-added" },
          {
            endpoint: endpointKey,
            location: "endpoint",
            polarity: "out",
          },
        ),
      );
      continue;
    }
    if (oldEndpoint === undefined || newEndpoint === undefined) continue;

    for (const { location, polarity, oldNode, newNode } of endpointLocations(
      oldEndpoint,
      newEndpoint,
    )) {
      if (oldNode === null && newNode === null) continue;
      const rawDiffs: RawDiff[] = [];
      // Gaining or losing a schema is any↔typed: the wire may be unchanged.
      diffNode(oldNode ?? NULL_AS_ANY, newNode ?? NULL_AS_ANY, "", rawDiffs);
      for (const raw of rawDiffs) {
        entries.push(
          finish(raw, { endpoint: endpointKey, location, polarity }),
        );
      }
    }
  }

  return entries;
}
