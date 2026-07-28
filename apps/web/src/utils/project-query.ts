import { queryOptions } from "@tanstack/react-query";
import { env } from "@versionless/env/web";

import { hexclaveClientApp } from "@/hexclave/client";
import { getServerUrl } from "@/utils/server-url";

export type QueryParameter = string | number | boolean | null;

export class ProjectQueryHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProjectQueryHttpError";
  }
}

export function isProjectQueryUnavailable(error: unknown): boolean {
  return error instanceof ProjectQueryHttpError && error.status >= 500;
}

async function postQuery<TRow>(
  path: string,
  payload: Record<string, unknown>,
): Promise<TRow[]> {
  const authorization = await hexclaveClientApp.getAuthorizationHeader();
  const response = await fetch(`${getServerUrl(env.VITE_SERVER_URL)}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as {
    result?: TRow[];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new ProjectQueryHttpError(
      body?.error ?? `Query failed with HTTP ${response.status}`,
      response.status,
    );
  }
  if (!body || !Array.isArray(body.result)) {
    throw new ProjectQueryHttpError("The query returned an invalid response", 502);
  }
  return body.result;
}

/** ClickHouse: telemetry. Named `{name:Type}` parameters. */
export async function projectQuery<TRow>(
  projectId: string,
  query: string,
  params: Record<string, QueryParameter> = {},
  timeoutMs = 10_000,
): Promise<TRow[]> {
  return postQuery<TRow>("/v1/query", {
    projectId,
    query,
    params,
    timeoutMs,
  });
}

/**
 * Postgres: release metadata (projects, contracts, sunsets). Binds by
 * position, so `params` is an ordered array for `$1..$n` rather than the named
 * record ClickHouse takes.
 */
export async function projectPgQuery<TRow>(
  projectId: string,
  query: string,
  params: QueryParameter[] = [],
  timeoutMs = 10_000,
): Promise<TRow[]> {
  return postQuery<TRow>("/v1/pg-query", {
    projectId,
    query,
    params,
    timeoutMs,
  });
}

export function projectQueryOptions<TRow, TResult = TRow[]>(
  name: string,
  input: {
    projectId: string;
    query: string;
    params?: Record<string, QueryParameter>;
    timeoutMs?: number;
    /**
     * Non-SQL inputs that change the shaped result — e.g. release metadata
     * merged in by `select`. Without these in the key, the same SQL would
     * serve a cached result shaped by stale metadata.
     */
    keyExtra?: unknown;
  },
  select?: (rows: TRow[]) => TResult,
) {
  return queryOptions({
    queryKey: [
      "project-query",
      name,
      input.projectId,
      input.query,
      input.params ?? {},
      ...(input.keyExtra === undefined ? [] : [input.keyExtra]),
    ] as const,
    queryFn: async () => {
      const rows = await projectQuery<TRow>(
        input.projectId,
        input.query,
        input.params,
        input.timeoutMs,
      );
      return select ? select(rows) : (rows as TResult);
    },
    enabled: input.projectId !== "",
    retry: false,
  });
}

export function projectPgQueryOptions<TRow, TResult = TRow[]>(
  name: string,
  input: {
    projectId: string;
    query: string;
    params?: QueryParameter[];
    timeoutMs?: number;
    keyExtra?: unknown;
  },
  select?: (rows: TRow[]) => TResult,
) {
  return queryOptions({
    queryKey: [
      "project-pg-query",
      name,
      input.projectId,
      input.query,
      input.params ?? [],
      ...(input.keyExtra === undefined ? [] : [input.keyExtra]),
    ] as const,
    queryFn: async () => {
      const rows = await projectPgQuery<TRow>(
        input.projectId,
        input.query,
        input.params,
        input.timeoutMs,
      );
      return select ? select(rows) : (rows as TResult);
    },
    enabled: input.projectId !== "",
    retry: false,
  });
}
