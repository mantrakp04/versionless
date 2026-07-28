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
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectQueryError";
  }
}

export class ProjectQueryUnavailableError extends ProjectQueryError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
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

export function resolveClickHouseDatabase(
  clickHouseUrl: string,
  configuredDatabase?: string,
): string {
  if (configuredDatabase) return configuredDatabase;
  const parsed = new URL(clickHouseUrl);
  return decodeURIComponent(
    parsed.pathname.replace(/^\/+|\/+$/g, "") || "default",
  );
}

function connection(): ClickHouseConnection {
  if (!env.CLICKHOUSE_URL) {
    throw new ProjectQueryUnavailableError(
      "ClickHouse unavailable — set CLICKHOUSE_URL and run `bun start-deps`",
    );
  }
  const parsed = new URL(env.CLICKHOUSE_URL);
  return {
    url: `${parsed.protocol}//${parsed.host}`,
    database: resolveClickHouseDatabase(
      env.CLICKHOUSE_URL,
      env.CLICKHOUSE_DATABASE,
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

/** Pre-aggregated daily table the overview reads instead of raw log rows. */
export const ROLLUP_TABLE = "versionless_rollup_daily";
/**
 * The MV name carries a generation suffix. `CREATE MATERIALIZED VIEW IF NOT
 * EXISTS` will not update an existing view's SELECT, so widening the rollup
 * means retiring the previous generation and creating the next one. Both
 * statements are no-ops on a second run, unlike an unconditional drop-recreate
 * which would open an ingestion gap at every restart.
 */
const ROLLUP_MV = "versionless_rollup_daily_mv_v2";
const RETIRED_ROLLUP_MVS = ["versionless_rollup_daily_mv"];
/** Columns added after the rollup's first generation; see the ALTERs below. */
const ROLLUP_ADDED_COLUMNS = ["sourced", "unpinned", "clamped"];
/** Retention of the raw rows the rollup is backfilled from. */
const ROLLUP_BACKFILL_DAYS = 180;

/**
 * The rollup's aggregate expressions, shared verbatim by the materialized view
 * and the backfill so the two can never drift apart. Keyed on the dimensions
 * the overview groups by; anything finer (consumer, status, trace) stays a raw
 * drill-down.
 *
 * Tenancy is projected into real columns: row policies on the raw tables filter
 * `ResourceAttributes`, which a rollup row does not carry.
 */
const ROLLUP_SELECT = `SELECT
  ResourceAttributes['versionless.team.id'] AS team_id,
  ResourceAttributes['versionless.project.id'] AS project_id,
  toDate(Timestamp) AS day,
  LogAttributes['versionless.version'] AS version,
  LogAttributes['versionless.route'] AS route,
  LogAttributes['versionless.method'] AS method,
  count() AS requests,
  countIf(toUInt16OrZero(LogAttributes['http.response.status_code']) >= 400) AS errors,
  quantilesTDigestState(0.5, 0.95, 0.99)(
    toFloat64OrZero(LogAttributes['versionless.latency_ms'])
  ) AS latency,
  sum(toUInt8OrZero(LogAttributes['versionless.transform_count'])) AS depth_sum,
  max(toUInt8OrZero(LogAttributes['versionless.transform_count'])) AS depth_max,
  uniqState(if(
    empty(LogAttributes['versionless.consumer.key']),
    'anonymous',
    LogAttributes['versionless.consumer.key']
  )) AS consumers,
  countIf(notEmpty(LogAttributes['versionless.version.requested'])) AS negotiated,
  countIf(notEmpty(LogAttributes['versionless.version.source'])) AS sourced,
  countIf(LogAttributes['versionless.version.source'] = 'default') AS unpinned,
  countIf(LogAttributes['versionless.clamped'] = 'true') AS clamped`;

const ROLLUP_GROUP_BY = `GROUP BY team_id, project_id, day, version, route, method`;

export function queryAccessStatements(database: string): string[] {
  const db = identifier(database);
  const project =
    "ResourceAttributes['versionless.project.id'] = getSetting('SQL_project_id')";
  const team =
    "ResourceAttributes['versionless.team.id'] = getSetting('SQL_team_id')";
  // The rollup carries tenancy as ordinary columns, so its policy must filter
  // on those instead — using the raw-table predicate here would reference
  // columns that do not exist and leave the table readable across tenants.
  const rollupProject = "project_id = getSetting('SQL_project_id')";
  const rollupTeam = "team_id = getSetting('SQL_team_id')";
  const policy = (table: string) => `${table}_versionless_project_isolation`;
  const isolate = (table: string, using: string) => [
    `CREATE ROW POLICY IF NOT EXISTS ${policy(table)} ON ${db}.${table} FOR SELECT USING ${using} TO ${QUERY_USER}`,
    // ALTER after CREATE so an existing policy from an older deploy is brought
    // up to the current predicate rather than silently left behind.
    `ALTER ROW POLICY ${policy(table)} ON ${db}.${table} FOR SELECT USING ${using} TO ${QUERY_USER}`,
  ];

  return [
    `CREATE USER IF NOT EXISTS ${QUERY_USER} IDENTIFIED WITH sha256_password BY {queryPassword:String}`,
    `ALTER USER ${QUERY_USER} IDENTIFIED WITH sha256_password BY {queryPassword:String}`,

    // Rollup storage. AggregatingMergeTree merges same-key rows, so the MV can
    // insert a partial row per batch and the table converges on one row per
    // (tenant, day, version, route, method).
    `CREATE TABLE IF NOT EXISTS ${db}.${ROLLUP_TABLE} (
  team_id String,
  project_id String,
  day Date,
  version String,
  route String,
  method String,
  requests SimpleAggregateFunction(sum, UInt64),
  errors SimpleAggregateFunction(sum, UInt64),
  latency AggregateFunction(quantilesTDigest(0.5, 0.95, 0.99), Float64),
  depth_sum SimpleAggregateFunction(sum, UInt64),
  depth_max SimpleAggregateFunction(max, UInt8),
  consumers AggregateFunction(uniq, String),
  negotiated SimpleAggregateFunction(sum, UInt64),
  sourced SimpleAggregateFunction(sum, UInt64),
  unpinned SimpleAggregateFunction(sum, UInt64),
  clamped SimpleAggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (team_id, project_id, day, version, route, method)
TTL day + INTERVAL ${ROLLUP_BACKFILL_DAYS} DAY`,

    // Widen a rollup created by an earlier deploy. CREATE TABLE IF NOT EXISTS
    // is a no-op on an existing table, so a new aggregate needs its own ADD
    // COLUMN or the MV insert fails on an unknown column. Every added column
    // defaults to 0 for days already rolled up — which is why `sourced` exists:
    // a window with `sourced = 0` reports "not recorded" rather than "0%".
    ...ROLLUP_ADDED_COLUMNS.map(
      (column) =>
        `ALTER TABLE ${db}.${ROLLUP_TABLE} ADD COLUMN IF NOT EXISTS ${column} SimpleAggregateFunction(sum, UInt64)`,
    ),

    // A materialized view's SELECT is fixed at creation, so widening the rollup
    // retires the previous generation instead of trying to update it in place.
    ...RETIRED_ROLLUP_MVS.map(
      (view) => `DROP VIEW IF EXISTS ${db}.${view}`,
    ),

    `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${ROLLUP_MV}
TO ${db}.${ROLLUP_TABLE} AS
${ROLLUP_SELECT}
FROM ${db}.otel_logs
WHERE EventName = 'versionless.request'
${ROLLUP_GROUP_BY}`,

    // Backfill the history the MV never saw. Bounded to days before today and
    // guarded on those same days being absent, which makes it idempotent
    // without racing the MV: traffic arriving between the two statements lands
    // on today() and so cannot trip the guard and skip the backfill.
    `INSERT INTO ${db}.${ROLLUP_TABLE}
${ROLLUP_SELECT}
FROM ${db}.otel_logs
WHERE EventName = 'versionless.request'
  AND Timestamp >= now() - INTERVAL ${ROLLUP_BACKFILL_DAYS} DAY
  AND Timestamp < toDateTime(today())
  AND (SELECT count() FROM ${db}.${ROLLUP_TABLE} WHERE day < today()) = 0
${ROLLUP_GROUP_BY}`,

    ...isolate("otel_logs", `${project} AND ${team}`),
    ...isolate("otel_traces", `${project} AND ${team}`),
    ...isolate(ROLLUP_TABLE, `${rollupProject} AND ${rollupTeam}`),

    `REVOKE ALL PRIVILEGES ON *.* FROM ${QUERY_USER}`,
    `GRANT SELECT ON ${db}.otel_logs TO ${QUERY_USER}`,
    `GRANT SELECT ON ${db}.otel_traces TO ${QUERY_USER}`,
    `GRANT SELECT ON ${db}.${ROLLUP_TABLE} TO ${QUERY_USER}`,
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
      { cause: error },
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
