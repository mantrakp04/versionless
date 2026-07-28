import { publicQueryHttpError } from "@versionless/api/error-policy";
import { getHexclaveServerApp } from "@versionless/api/lib/hexclave";
import {
  executeProjectPgQuery,
  MAX_QUERY_TIMEOUT_MS,
  type ProjectPgQueryInput,
} from "@versionless/api/lib/postgres-query";
import {
  requireProjectAccess,
  type ProjectAccessUser,
} from "@versionless/api/lib/project-access";
import { CURRENT_VERSION, v } from "@versionless/api/versionless";
import { Elysia } from "elysia";
import { z } from "zod";

const pgQueryParameterSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * Postgres binds by position, so params is an ordered array for `$1..$n`
 * rather than the named record the ClickHouse plane takes.
 */
export const projectPgQueryRequestSchema = z.object({
  projectId: z.uuid(),
  query: z.string().min(1).max(100_000),
  params: z.array(pgQueryParameterSchema).max(64).default([]),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(MAX_QUERY_TIMEOUT_MS)
    .default(10_000),
});

type PgQueryRouteDependencies = {
  getUser(request: Request): Promise<ProjectAccessUser | null>;
  authorizeProject: typeof requireProjectAccess;
  executeQuery(
    input: ProjectPgQueryInput,
  ): ReturnType<typeof executeProjectPgQuery>;
  reportError?(error: unknown, projectId: string): void;
  recordTelemetry?(status: number, latencyMs: number): Promise<void>;
};

const defaultDependencies: PgQueryRouteDependencies = {
  async getUser(request) {
    return (
      (await getHexclaveServerApp()?.getUser({ tokenStore: request })) ?? null
    );
  },
  authorizeProject: requireProjectAccess,
  executeQuery: executeProjectPgQuery,
  reportError(error, projectId) {
    console.error("[project-pg-query] Postgres query failed", {
      projectId,
      error,
    });
  },
  async recordTelemetry(status, latencyMs) {
    v.telemetry.emit({
      ts: Date.now(),
      method: "POST",
      route: "POST /v1/pg-query",
      adapter: "elysia",
      version: CURRENT_VERSION,
      latencyMs,
      transformCount: 0,
      status,
    });
    // emit() fans out in a microtask; yield once before draining the sinks.
    await Promise.resolve();
    await v.telemetry.flush();
  },
};

/**
 * Authenticated read-only Postgres endpoint over release metadata (projects,
 * uploaded contracts, sunsets). The ClickHouse plane's sibling, and the same
 * shape: authentication picks the trusted project/team, and row-level security
 * — not SQL rewriting — enforces isolation on every scan. The body's projectId
 * is only ever an authorization input; the values handed to the query come
 * from the authorized project row.
 */
export function createProjectPgQueryApp(
  dependencies: PgQueryRouteDependencies = defaultDependencies,
) {
  return new Elysia({ name: "versionless-project-pg-query" }).post(
    "/v1/pg-query",
    async ({ body, request, status }) => {
      const startedAt = performance.now();
      let responseStatus = 200;
      try {
        const user = await dependencies.getUser(request);
        if (!user) {
          responseStatus = 401;
          return status(401, { error: "Sign in required" });
        }

        try {
          const { project } = await dependencies.authorizeProject(
            user,
            body.projectId,
          );
          const result = await dependencies.executeQuery({
            projectId: project.id,
            teamId: project.teamId,
            query: body.query,
            params: body.params,
            timeoutMs: body.timeoutMs,
          });
          return {
            result: result.result,
            query_id: result.queryId,
          };
        } catch (error) {
          dependencies.reportError?.(error, body.projectId);
          // Same policy table as the tRPC error formatter: production gets
          // public copy, development keeps the diagnostic (server logs own it).
          const publicError = publicQueryHttpError(error);
          responseStatus = publicError.status;
          return status(publicError.status, { error: publicError.message });
        }
      } finally {
        await dependencies.recordTelemetry?.(
          responseStatus,
          Math.round(performance.now() - startedAt),
        );
      }
    },
    { body: projectPgQueryRequestSchema },
  );
}

export const projectPgQueryApp = createProjectPgQueryApp();
