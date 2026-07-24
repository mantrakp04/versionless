export interface ManualEndpoint {
  method: string;
  path: string;
  /** zod schema or raw JSON Schema */
  params?: unknown;
  /** zod schema or raw JSON Schema */
  query?: unknown;
  /** zod schema or raw JSON Schema */
  body?: unknown;
  /** zod schema or raw JSON Schema */
  response: unknown;
}

export interface SurfaceDefinition {
  trpc?: { router: unknown; mount?: string }[];
  /** oRPC routers — procedures share the `trpc:` endpoint namespace. */
  orpc?: { router: unknown; mount?: string }[];
  /** Elysia app instances — routes are read from `app.routes`. */
  elysia?: unknown[];
  /** Named zod/typebox schemas — referenced by identity from endpoints. */
  models?: Record<string, unknown>;
  manual?: ManualEndpoint[];
}

export function defineSurface(
  def: SurfaceDefinition,
): SurfaceDefinition & { __versionless: true } {
  return { ...def, __versionless: true };
}
