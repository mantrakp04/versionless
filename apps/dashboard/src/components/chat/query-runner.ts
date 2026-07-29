import type { QueryParameter } from "@/utils/project-query";
import type { QuerySource } from "./query-sql";

export interface QueryRunnerInput {
  source: QuerySource;
  query: string;
  params?: Record<string, QueryParameter> | QueryParameter[];
}

/**
 * Executes a project-bound query without exposing the project identity or
 * browser credentials to the caller. The parent app and sandbox runtime
 * provide different implementations of this boundary.
 */
export type QueryRunner = <TRow>(
  input: QueryRunnerInput,
) => Promise<TRow[]>;
