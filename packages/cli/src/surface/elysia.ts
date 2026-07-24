import { isZodSchema } from "./zod";
import { isTypeBoxSchema } from "./typebox";
import { convertSchema } from "./convert";
import type { SchemaConverter } from "./convert";
import type { HttpEndpoint, TypeNode } from "./types";

interface RouteLike {
  method?: unknown;
  path?: unknown;
  hooks?: unknown;
  websocket?: unknown;
}

/** A schema-ish value: zod, TypeBox, or raw JSON Schema object. */
function isSchema(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (isZodSchema(value) || isTypeBoxSchema(value)) return true;
  // Raw JSON Schema heuristic — anything with structural schema markers.
  const s = value as Record<string, unknown>;
  return (
    "type" in s ||
    "properties" in s ||
    "anyOf" in s ||
    "oneOf" in s ||
    "allOf" in s ||
    "enum" in s ||
    "const" in s ||
    "$ref" in s ||
    "items" in s
  );
}

/**
 * Normalize an Elysia `response` hook value to a status → schema map.
 * Elysia accepts either a bare schema (implicitly 200) or `{200: ..., 404: ...}`.
 */
function normalizeResponses(response: unknown): Record<string, unknown> {
  if (response === undefined || response === null) return {};
  if (isSchema(response)) return { "200": response };
  if (typeof response === "object") {
    const map: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(response)) {
      if (/^\d{3}$/.test(key) && value !== undefined) map[key] = value;
    }
    if (Object.keys(map).length > 0) return map;
  }
  return {};
}

/**
 * Walk an Elysia app's route table and produce IR endpoints.
 *
 * Verified against installed elysia 1.4.29 (dist/types.d.ts + runtime):
 * - `app.routes` is `InternalRoute[]`: `{ method, path, hooks, websocket? }`.
 * - `hooks` carries the raw, user-supplied `body` / `query` / `params` /
 *   `response` schemas (TypeBox `t.*` objects tagged with
 *   `Symbol.for("TypeBox.Kind")`, or any Standard Schema — e.g. zod).
 * - `response` may be a bare schema or a `{ 200: ..., 404: ... }` status map.
 *
 * Routes with no schemas are still recorded (method + path with null bodies).
 * WebSocket routes are skipped.
 */
export function fromElysiaApp(
  app: unknown,
  convert: SchemaConverter = convertSchema,
): Record<string, HttpEndpoint> {
  const endpoints: Record<string, HttpEndpoint> = {};
  const routes = (app as { routes?: unknown } | null | undefined)?.routes;
  if (!Array.isArray(routes)) return endpoints;

  for (const raw of routes as RouteLike[]) {
    if (typeof raw !== "object" || raw === null) continue;
    if (raw.websocket !== undefined) continue; // WS routes have no wire schema story yet
    const { method, path } = raw;
    if (typeof method !== "string" || typeof path !== "string") continue;

    const hooks =
      typeof raw.hooks === "object" && raw.hooks !== null
        ? (raw.hooks as Record<string, unknown>)
        : {};

    const input = (value: unknown): TypeNode | null =>
      value === undefined || value === null ? null : convert(value, "input");

    const responses: Record<string, TypeNode> = {};
    for (const [status, schema] of Object.entries(
      normalizeResponses(hooks["response"]),
    )) {
      responses[status] = convert(schema, "output");
    }

    endpoints[`${method.toUpperCase()} ${path}`] = {
      transport: "http",
      method: method.toUpperCase(),
      path,
      params: input(hooks["params"]),
      query: input(hooks["query"]),
      body: input(hooks["body"]),
      responses,
    };
  }
  return endpoints;
}
