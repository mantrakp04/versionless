import { useQuery } from "@tanstack/react-query";

import {
  type QueryParameter,
} from "@/utils/project-query";
import { splitParams, type QuerySource } from "./query-sql";
import type { QueryRunner } from "./query-runner";

/**
 * One query against either store. The two `*QueryOptions` helpers are typed
 * around their own key tuples, so a ternary between them will not unify —
 * this keeps the branch inside a single `queryFn` instead.
 */
export function useSourceQuery<TRow>(input: {
  name: string;
  projectId: string;
  source: QuerySource;
  query: string;
  params?: Record<string, QueryParameter> | QueryParameter[];
  runQuery: QueryRunner;
}) {
  const { named, positional } = splitParams(input.source, input.params);
  return useQuery<TRow[]>({
    queryKey: [
      "chat-source-query",
      input.name,
      input.source,
      input.projectId,
      input.query,
      named,
      positional,
    ],
    enabled: input.projectId !== "",
    retry: false,
    queryFn: () =>
      input.runQuery<TRow>({
        source: input.source,
        query: input.query,
        params: input.source === "postgres" ? positional : named,
      }),
  });
}
