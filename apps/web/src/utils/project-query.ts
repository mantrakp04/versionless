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

export async function projectQuery<TRow>(
  projectId: string,
  query: string,
  params: Record<string, QueryParameter> = {},
  timeoutMs = 10_000,
): Promise<TRow[]> {
  const authorization = await hexclaveClientApp.getAuthorizationHeader();
  const response = await fetch(`${getServerUrl(env.VITE_SERVER_URL)}/v1/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ projectId, query, params, timeoutMs }),
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

export function projectQueryOptions<TRow, TResult = TRow[]>(
  name: string,
  input: {
    projectId: string;
    query: string;
    params?: Record<string, QueryParameter>;
    timeoutMs?: number;
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
