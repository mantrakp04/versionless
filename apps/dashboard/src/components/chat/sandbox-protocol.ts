import type { QueryParameter } from "@/utils/project-query";
import { MAX_SANDBOX_HEIGHT } from "./sandbox-height";
import type { QuerySource } from "./query-sql";

export const CHAT_SANDBOX_CHANNEL = "versionless-chat-sandbox-v1";

export interface SandboxRenderMessage {
  channel: typeof CHAT_SANDBOX_CHANNEL;
  type: "render";
  source: string;
  streaming: boolean;
  theme: "light" | "dark";
}

export interface SandboxReadyMessage {
  channel: typeof CHAT_SANDBOX_CHANNEL;
  type: "ready";
}

export interface SandboxHeightMessage {
  channel: typeof CHAT_SANDBOX_CHANNEL;
  type: "height";
  height: number;
}

export interface SandboxQueryRequest {
  channel: typeof CHAT_SANDBOX_CHANNEL;
  type: "query";
  requestId: string;
  source: QuerySource;
  query: string;
  params?: Record<string, QueryParameter> | QueryParameter[];
}

export interface SandboxQueryResult {
  channel: typeof CHAT_SANDBOX_CHANNEL;
  type: "query-result";
  requestId: string;
  rows?: Record<string, unknown>[];
  error?: string;
}

export type SandboxToParentMessage =
  | SandboxReadyMessage
  | SandboxHeightMessage
  | SandboxQueryRequest;

export type ParentToSandboxMessage =
  | SandboxRenderMessage
  | SandboxQueryResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQueryParameter(value: unknown): value is QueryParameter {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isQueryParams(
  value: unknown,
): value is Record<string, QueryParameter> | QueryParameter[] | undefined {
  if (value === undefined) return true;
  if (Array.isArray(value)) {
    return value.length <= 100 && value.every(isQueryParameter);
  }
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 100 && entries.every(([, item]) => isQueryParameter(item));
}

export function isSandboxToParentMessage(
  value: unknown,
): value is SandboxToParentMessage {
  if (!isRecord(value) || value.channel !== CHAT_SANDBOX_CHANNEL) return false;

  if (value.type === "ready") return true;
  if (value.type === "height") {
    return (
      typeof value.height === "number" &&
      Number.isFinite(value.height) &&
      value.height >= 0 &&
      value.height <= MAX_SANDBOX_HEIGHT
    );
  }
  if (value.type !== "query") return false;

  return (
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    value.requestId.length <= 100 &&
    (value.source === "clickhouse" || value.source === "postgres") &&
    typeof value.query === "string" &&
    value.query.trim().length > 0 &&
    value.query.length <= 100_000 &&
    isQueryParams(value.params)
  );
}

export function isParentToSandboxMessage(
  value: unknown,
): value is ParentToSandboxMessage {
  if (!isRecord(value) || value.channel !== CHAT_SANDBOX_CHANNEL) return false;

  if (value.type === "render") {
    return (
      typeof value.source === "string" &&
      typeof value.streaming === "boolean" &&
      (value.theme === "light" || value.theme === "dark")
    );
  }
  if (value.type !== "query-result") return false;

  return (
    typeof value.requestId === "string" &&
    (value.rows === undefined ||
      (Array.isArray(value.rows) && value.rows.every(isRecord))) &&
    (value.error === undefined || typeof value.error === "string")
  );
}
