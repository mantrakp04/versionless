import { publicQueryHttpError } from "@versionless/api/error-policy";
import { finishVersionlessResponse } from "@versionless/adapter-elysia";
import {
  executeProjectQuery,
  MAX_QUERY_TIMEOUT_MS,
  type ProjectQueryInput,
} from "@versionless/api/lib/clickhouse-query";
import { getHexclaveServerApp } from "@versionless/api/lib/hexclave";
import {
  requireProjectAccess,
  type ProjectAccessUser,
} from "@versionless/api/lib/project-access";
import { Elysia } from "elysia";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";

const queryParameterSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const projectQueryRequestSchema = z.object({
  projectId: z.uuid(),
  query: z.string().min(1).max(100_000),
  params: z.record(z.string(), queryParameterSchema).default({}),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(MAX_QUERY_TIMEOUT_MS)
    .default(10_000),
});

type QueryRouteDependencies = {
  getUser(request: Request): Promise<ProjectAccessUser | null>;
  authorizeProject: typeof requireProjectAccess;
  executeQuery(input: ProjectQueryInput): ReturnType<typeof executeProjectQuery>;
  reportError?(error: unknown, projectId: string): void;
};

const defaultDependencies: QueryRouteDependencies = {
  async getUser(request) {
    return (
      (await getHexclaveServerApp()?.getUser({ tokenStore: request })) ?? null
    );
  },
  authorizeProject: requireProjectAccess,
  executeQuery: executeProjectQuery,
  reportError(error, projectId) {
    console.error("[project-query] ClickHouse query failed", {
      projectId,
      error,
    });
  },
};

/**
 * Authenticated raw ClickHouse SQL endpoint. Authentication selects the
 * trusted project/team settings; ClickHouse row policies—not SQL rewriting—
 * enforce isolation for every table scan.
 */
export function createProjectQueryApp(
  dependencies: QueryRouteDependencies = defaultDependencies,
) {
  return new Elysia({ name: "versionless-project-query" })
    // Parent lifecycle hooks do not propagate into mounted Elysia plugins.
    // Finalize inside this child while its handler promise is still awaited.
    .onAfterHandle((ctx) =>
      finishVersionlessResponse(ctx, { waitUntil }),
    )
    .post(
    "/v1/query",
    async ({ body, request, status }) => {
      const user = await dependencies.getUser(request);
      if (!user) {
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
        return status(publicError.status, { error: publicError.message });
      }
    },
    { body: projectQueryRequestSchema },
    );
}

export const projectQueryApp = createProjectQueryApp();
