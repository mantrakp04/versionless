import { expect, test } from "bun:test";

import type { QueryParameter } from "@/utils/project-query";
import { executeSandboxQuery } from "./mdx-message";
import {
  CHAT_SANDBOX_CHANNEL,
  type SandboxQueryRequest,
} from "./sandbox-protocol";

test("executes a sandbox query against the parent-bound project", async () => {
  const calls: unknown[] = [];
  const request: SandboxQueryRequest & { projectId?: string } = {
    channel: CHAT_SANDBOX_CHANNEL,
    type: "query",
    requestId: "request-1",
    source: "clickhouse",
    query: "SELECT count() FROM otel_logs",
    params: { days: 7 },
    // Even a forged extra field is not part of the protocol and is ignored.
    projectId: "p_forged",
  };

  const rows = await executeSandboxQuery<{ count: number }>(
    request,
    "p_authorized",
    {
      clickhouse: async <TRow>(
        projectId: string,
        query: string,
        params?: Record<string, QueryParameter>,
      ) => {
        calls.push({ projectId, query, params });
        return [{ count: 42 }] as TRow[];
      },
      postgres: async () => {
        throw new Error("unexpected postgres query");
      },
    },
  );

  expect(calls).toEqual([
    {
      projectId: "p_authorized",
      query: "SELECT count() FROM otel_logs",
      params: { days: 7 },
    },
  ]);
  expect(rows).toEqual([{ count: 42 }]);
});
