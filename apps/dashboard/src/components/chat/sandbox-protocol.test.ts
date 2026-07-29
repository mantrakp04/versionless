import { expect, test } from "bun:test";

import {
  CHAT_SANDBOX_CHANNEL,
  isParentToSandboxMessage,
  isSandboxToParentMessage,
} from "./sandbox-protocol";

test("accepts a bounded query request without a project identity", () => {
  expect(
    isSandboxToParentMessage({
      channel: CHAT_SANDBOX_CHANNEL,
      type: "query",
      requestId: "request-1",
      source: "clickhouse",
      query: "SELECT count() AS requests FROM otel_logs",
      params: { days: 7 },
    }),
  ).toBe(true);
});

test("rejects malformed and unbounded sandbox messages", () => {
  expect(
    isSandboxToParentMessage({
      channel: CHAT_SANDBOX_CHANNEL,
      type: "query",
      requestId: "request-1",
      source: "mysql",
      query: "SELECT 1",
    }),
  ).toBe(false);
  expect(
    isSandboxToParentMessage({
      channel: CHAT_SANDBOX_CHANNEL,
      type: "query",
      requestId: "request-1",
      source: "clickhouse",
      query: "x".repeat(100_001),
    }),
  ).toBe(false);
  expect(
    isSandboxToParentMessage({
      channel: CHAT_SANDBOX_CHANNEL,
      type: "height",
      height: Number.POSITIVE_INFINITY,
    }),
  ).toBe(false);
  expect(
    isSandboxToParentMessage({
      channel: CHAT_SANDBOX_CHANNEL,
      type: "height",
      height: 100_001,
    }),
  ).toBe(false);
});

test("accepts only the render and structured query-result parent messages", () => {
  expect(
    isParentToSandboxMessage({
      channel: CHAT_SANDBOX_CHANNEL,
      type: "render",
      source: "## Adoption",
      streaming: false,
      theme: "dark",
    }),
  ).toBe(true);
  expect(
    isParentToSandboxMessage({
      channel: CHAT_SANDBOX_CHANNEL,
      type: "query-result",
      requestId: "request-1",
      rows: [{ requests: 42 }],
    }),
  ).toBe(true);
  expect(
    isParentToSandboxMessage({
      channel: CHAT_SANDBOX_CHANNEL,
      type: "query-result",
      requestId: "request-1",
      rows: ["not-a-row"],
    }),
  ).toBe(false);
});
