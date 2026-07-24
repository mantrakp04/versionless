import {
  createClient,
  type ClickHouseClient,
  type ClickHouseSettings,
} from "@clickhouse/client-web";
import { env } from "@versionless/env/server";
import { randomUUID } from "node:crypto";
import { safeClickHouseError } from "./clickhouse-errors";

export const QUERY_USER = "versionless_query";
export const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
export const MAX_QUERY_TIMEOUT_MS = 60_000;
export const MAX_RESULT_ROWS = 10_000;
export const MAX_RESULT_BYTES = 10 * 1024 * 1024;

export type QueryParameter = string | number | boolean | null;

export interface ProjectQueryInput {
  projectId: string;
  teamId: string;
  query: string;
  params?: Record<string, QueryParameter>;
  timeoutMs?: number;
}

export interface ProjectQueryResult {
  result: Record<string, unknown>[];
  queryId: string;
}

export class ProjectQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectQueryError";
  }
}

export class ProjectQueryUnavailableError extends ProjectQueryError {
  constructor(message: string) {
    super(message);
    this.name = "ProjectQueryUnavailableError";
  }
}

type QueryResult = {
  json<T>(): Promise<T[]>;
};

export interface RestrictedQueryClient {
  query(options: {
    query: string;
    query_id: string;
    query_params: Record<string, QueryParameter>;
    clickhouse_settings: ClickHouseSettings;
    format: "JSONEachRow";
  }): Promise<QueryResult>;
}

export interface ClickHouseCommandClient {
  command(options: {
    query: string;
    query_params?: Record<string, string>;
  }): Promise<unknown>;
}

interface ClickHouseConnection {
  url: string;
  database: string;
  username: string;
  password: string;
}

function connection(): ClickHouseConnection {
  if (!env.CLICKHOUSE_URL) {
    throw new ProjectQueryUnavailableError(
      "ClickHouse unavailable — set CLICKHOUSE_URL and run `bun db:start`",
    );
  }
  const parsed = new URL(env.CLICKHOUSE_URL);
  return {
    url: `${parsed.protocol}//${parsed.host}`,
    database: decodeURIComponent(
      parsed.pathname.replace(/^\//, "") || "default",
    ),
    username: decodeURIComponent(parsed.username || "default"),
    password: decodeURIComponent(parsed.password || ""),
  };
}

function queryPassword(): string {
  return env.CLICKHOUSE_QUERY_PASSWORD;
}

function identifier(value: string): string {
  return `\`${value.replaceAll("`", "``")}\``;
}

export function queryAccessStatements(database: string): string[] {
  const db = identifier(database);
  const project =
    "ResourceAttributes['versionless.project.id'] = getSetting('SQL_project_id')";
  const team =
    "ResourceAttributes['versionless.team.id'] = getSetting('SQL_team_id')";
  const policy = (table: "otel_logs" | "otel_traces") =>
    `${table}_versionless_project_isolation`;
  return [
    `CREATE USER IF NOT EXISTS ${QUERY_USER} IDENTIFIED WITH sha256_password BY {queryPassword:String}`,
    `ALTER USER ${QUERY_USER} IDENTIFIED WITH sha256_password BY {queryPassword:String}`,
    `CREATE ROW POLICY IF NOT EXISTS ${policy("otel_logs")} ON ${db}.otel_logs FOR SELECT USING ${project} AND ${team} TO ${QUERY_USER}`,
    `ALTER ROW POLICY ${policy("otel_logs")} ON ${db}.otel_logs FOR SELECT USING ${project} AND ${team} TO ${QUERY_USER}`,
    `CREATE ROW POLICY IF NOT EXISTS ${policy("otel_traces")} ON ${db}.otel_traces FOR SELECT USING ${project} AND ${team} TO ${QUERY_USER}`,
    `ALTER ROW POLICY ${policy("otel_traces")} ON ${db}.otel_traces FOR SELECT USING ${project} AND ${team} TO ${QUERY_USER}`,
    `REVOKE ALL PRIVILEGES ON *.* FROM ${QUERY_USER}`,
    `GRANT SELECT ON ${db}.otel_logs TO ${QUERY_USER}`,
    `GRANT SELECT ON ${db}.otel_traces TO ${QUERY_USER}`,
  ];
}

let adminClient: ClickHouseClient | undefined;
let restrictedClient: ClickHouseClient | undefined;
let accessReady: Promise<void> | undefined;

function getAdminClient(): ClickHouseClient {
  if (adminClient) return adminClient;
  const config = connection();
  adminClient = createClient({
    url: config.url,
    database: config.database,
    username: config.username,
    password: config.password,
  });
  return adminClient;
}

function getRestrictedClient(): ClickHouseClient {
  if (restrictedClient) return restrictedClient;
  const config = connection();
  restrictedClient = createClient({
    url: config.url,
    database: config.database,
    username: QUERY_USER,
    password: queryPassword(),
  });
  return restrictedClient;
}

export async function provisionQueryAccess(
  client: ClickHouseCommandClient = getAdminClient(),
  database = connection().database,
  password = queryPassword(),
): Promise<void> {
  for (const query of queryAccessStatements(database)) {
    await client.command({
      query,
      query_params: query.includes("{queryPassword:String}")
        ? { queryPassword: password }
        : undefined,
    });
  }
}

export function ensureQueryAccess(): Promise<void> {
  accessReady ??= provisionQueryAccess().catch((error) => {
    accessReady = undefined;
    throw new ProjectQueryUnavailableError(
      safeClickHouseError(error, env.NODE_ENV === "development"),
    );
  });
  return accessReady;
}

export async function executeProjectQuery(
  input: ProjectQueryInput,
  dependencies: {
    ensureAccess?: () => Promise<void>;
    client?: RestrictedQueryClient;
    isDevelopment?: boolean;
  } = {},
): Promise<ProjectQueryResult> {
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS, 1_000),
    MAX_QUERY_TIMEOUT_MS,
  );
  await (dependencies.ensureAccess ?? ensureQueryAccess)();
  const client = dependencies.client ?? getRestrictedClient();
  const queryId = `${input.projectId}:${randomUUID()}`;

  try {
    const resultSet = await client.query({
      query: input.query,
      query_id: queryId,
      query_params: input.params ?? {},
      clickhouse_settings: {
        SQL_project_id: input.projectId,
        SQL_team_id: input.teamId,
        readonly: "1",
        allow_ddl: 0,
        max_execution_time: timeoutMs / 1000,
        max_result_rows: MAX_RESULT_ROWS.toString(),
        max_result_bytes: MAX_RESULT_BYTES.toString(),
        result_overflow_mode: "throw",
        max_memory_usage: "256000000",
        max_rows_to_read: "10000000",
        max_bytes_to_read: "1000000000",
      },
      format: "JSONEachRow",
    });
    return {
      result: await resultSet.json<Record<string, unknown>>(),
      queryId,
    };
  } catch (error) {
    throw new ProjectQueryError(
      safeClickHouseError(error, dependencies.isDevelopment),
    );
  }
}
