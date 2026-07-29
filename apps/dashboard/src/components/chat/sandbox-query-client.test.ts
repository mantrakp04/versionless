import { expect, test } from "bun:test";

import { createSandboxQueryClient } from "./sandbox-query-client";
import {
  CHAT_SANDBOX_CHANNEL,
  type SandboxQueryRequest,
} from "./sandbox-protocol";

test("round-trips a query without sending a project ID or credentials", async () => {
  const sent: object[] = [];
  const client = createSandboxQueryClient((message) => sent.push(message));

  const result = client.runQuery<{ requests: number }>({
    source: "clickhouse",
    query: "SELECT count() AS requests FROM otel_logs",
    params: { days: 7 },
  });

  const request = sent[0] as SandboxQueryRequest & {
    projectId?: unknown;
    authorization?: unknown;
  };
  expect(request.channel).toBe(CHAT_SANDBOX_CHANNEL);
  expect(request.projectId).toBeUndefined();
  expect(request.authorization).toBeUndefined();

  client.receive({
    channel: CHAT_SANDBOX_CHANNEL,
    type: "query-result",
    requestId: request.requestId,
    rows: [{ requests: 42 }],
  });

  expect(await result).toEqual([{ requests: 42 }]);
  client.dispose();
});

test("turns a safe parent error into a rejected sandbox query", async () => {
  const sent: object[] = [];
  const client = createSandboxQueryClient((message) => sent.push(message));
  const result = client.runQuery({
    source: "postgres",
    query: "SELECT version FROM project_versions",
    params: [],
  });
  const request = sent[0] as SandboxQueryRequest;

  client.receive({
    channel: CHAT_SANDBOX_CHANNEL,
    type: "query-result",
    requestId: request.requestId,
    error: "This query could not be run.",
  });

  expect(result).rejects.toThrow("This query could not be run.");
  client.dispose();
});
