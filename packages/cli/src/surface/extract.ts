import { canonicalize, stableStringify } from "./canonical";
import { convertSchema } from "./convert";
import { fromElysiaApp } from "./elysia";
import { fromOrpcRouter } from "./orpc";
import { fromTrpcRouter } from "./trpc";
import { registerZodModelIds } from "./zod";
import type { SurfaceDefinition } from "./define";
import type {
  HttpEndpoint,
  Surface,
  TrpcEndpoint,
  TypeNode,
} from "./types";

const TOOL = "@versionless/cli@0.0.1";

export function extractSurface(
  def: SurfaceDefinition,
  opts: { version: string },
): Surface {
  // Reference-identity map: schemas registered under `models` are emitted as
  // `{kind:"ref"}` wherever the exact same object appears in an endpoint.
  const modelNameBySchema = new Map<unknown, string>();
  for (const [name, schema] of Object.entries(def.models ?? {})) {
    if (typeof schema === "object" && schema !== null) {
      modelNameBySchema.set(schema, name);
    }
  }

  const modelNames = new Set(modelNameBySchema.values());
  const convert = (schema: unknown, io: "input" | "output"): TypeNode => {
    const name = modelNameBySchema.get(schema);
    if (name !== undefined) return { kind: "ref", name };
    return canonicalize(convertSchema(schema, io, modelNames));
  };

  // Model bodies convert BEFORE ids are registered so they stay fully inline
  // (a model referencing another model must not nest a ref — the differ only
  // expands model diffs to endpoint usage sites).
  const models: Record<string, TypeNode> = {};
  for (const [name, schema] of Object.entries(def.models ?? {})) {
    models[name] = canonicalize(convertSchema(schema, "output"));
  }

  const endpoints: Record<string, HttpEndpoint | TrpcEndpoint> = {};

  const restoreModelIds = registerZodModelIds(modelNameBySchema);
  try {
    const procedureSources = [
      ...(def.trpc ?? []).map((source) => ({
        ...source,
        extract: fromTrpcRouter,
        defaultMount: "/trpc",
      })),
      ...(def.orpc ?? []).map((source) => ({
        ...source,
        extract: fromOrpcRouter,
        defaultMount: "/rpc",
      })),
    ];
    for (const { router, mount, extract: extractRouter, defaultMount } of procedureSources) {
      const extracted = extractRouter(router, mount ?? defaultMount, convert);
      for (const [key, endpoint] of Object.entries(extracted)) {
        endpoints[key] = {
          ...endpoint,
          input: endpoint.input === null ? null : canonicalize(endpoint.input),
          output: endpoint.output === null ? null : canonicalize(endpoint.output),
        };
      }
    }

    for (const manual of def.manual ?? []) {
      const key = `${manual.method.toUpperCase()} ${manual.path}`;
      endpoints[key] = {
        transport: "http",
        method: manual.method.toUpperCase(),
        path: manual.path,
        params: manual.params === undefined ? null : convert(manual.params, "input"),
        query: manual.query === undefined ? null : convert(manual.query, "input"),
        body: manual.body === undefined ? null : convert(manual.body, "input"),
        responses: { "200": convert(manual.response, "output") },
      };
    }

    for (const app of def.elysia ?? []) {
      for (const [key, endpoint] of Object.entries(fromElysiaApp(app, convert))) {
        endpoints[key] = endpoint;
      }
    }
  } finally {
    restoreModelIds();
  }

  return {
    formatVersion: 1,
    version: opts.version,
    tool: TOOL,
    models,
    endpoints,
  };
}

export function serializeSurface(surface: Surface): string {
  return stableStringify(surface);
}
