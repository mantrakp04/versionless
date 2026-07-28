import { env } from "@versionless/env/server";
import { createRestrictedPool } from "@versionless/db/restricted-pool";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_QUERY_TIMEOUT_MS,
  MAX_RESULT_ROWS,
} from "./clickhouse-query";
import { safePostgresError } from "./postgres-errors";

export { DEFAULT_QUERY_TIMEOUT_MS, MAX_QUERY_TIMEOUT_MS, MAX_RESULT_ROWS };

/** Login role the query plane connects as. Owns no tables and cannot write. */
export const PG_QUERY_ROLE = "versionless_pg_query";

/**
 * The only tables the role may read. `telemetry_ingest_keys` is deliberately
 * absent: it is credential-adjacent, and nothing the dashboard assistant
 * answers needs it.
 */
export const PG_READABLE_TABLES = [
  "projects",
  "project_versions",
  "project_sunsets",
] as const;

/** Runtime GUCs the row policies read. Set transaction-locally per query. */
export const PG_PROJECT_SETTING = "versionless.project_id";
export const PG_TEAM_SETTING = "versionless.team_id";

export type PgQueryParameter = string | number | boolean | null;

export interface ProjectPgQueryInput {
  projectId: string;
  teamId: string;
  query: string;
  /** Positional values for `$1..$n`; Postgres has no named parameters. */
  params?: PgQueryParameter[];
  timeoutMs?: number;
}

export interface ProjectPgQueryResult {
  result: Record<string, unknown>[];
  queryId: string;
}

export class ProjectPgQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectPgQueryError";
  }
}

export class ProjectPgQueryUnavailableError extends ProjectPgQueryError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectPgQueryUnavailableError";
  }
}

export interface PgCommandClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export interface RestrictedPgQueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

export interface RestrictedPgQueryPool {
  connect(): Promise<RestrictedPgQueryClient>;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function policyName(table: string): string {
  return `${table}_versionless_project_isolation`;
}

/**
 * Idempotent DDL provisioning the restricted role and its row policies — the
 * Postgres analogue of `queryAccessStatements`.
 *
 * Two deliberate choices:
 *
 * - `ENABLE` and never `FORCE` row level security. The app's own owner
 *   connection is the table owner, and owners bypass non-forced RLS, so every
 *   existing tRPC router keeps its current behavior. Only the restricted role,
 *   which owns nothing, is filtered.
 * - The policies read `current_setting(..., true)`, whose missing-GUC form is
 *   NULL. A NULL comparison is never true, so a connection that forgot to
 *   scope itself reads zero rows instead of every row: fail-closed.
 *
 * The password arrives as a literal rather than a bind parameter because
 * `CREATE ROLE` and `ALTER ROLE` do not accept parameters. It never reaches a
 * log line — statements containing it are filtered out of error reporting by
 * the caller.
 */
export function pgQueryAccessStatements(password: string): string[] {
  const secret = quoteLiteral(password);
  const role = PG_QUERY_ROLE;

  const isolate = (table: string, using: string) => [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS ${policyName(table)} ON ${table}`,
    `CREATE POLICY ${policyName(table)} ON ${table}
  FOR SELECT TO ${role}
  USING (${using})`,
  ];

  const scopedToProject = `project_id::text = current_setting(${quoteLiteral(PG_PROJECT_SETTING)}, true)`;

  return [
    // CREATE ROLE has no IF NOT EXISTS, so the duplicate is caught instead.
    `DO $$ BEGIN
  CREATE ROLE ${role} LOGIN PASSWORD ${secret};
EXCEPTION WHEN duplicate_object THEN NULL;
END $$`,
    // Re-asserted every boot so a role loosened by hand is brought back to the
    // intended shape, and so a rotated password takes effect.
    `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${secret}`,

    `GRANT USAGE ON SCHEMA public TO ${role}`,
    // Revoke first: a table granted by an earlier deploy and since removed
    // from PG_READABLE_TABLES must lose the grant, not keep it.
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`,

    // `projects` keys on its own id and is additionally pinned to the team, so
    // a project id alone cannot be replayed against another tenant's row.
    ...isolate(
      "projects",
      `id::text = current_setting(${quoteLiteral(PG_PROJECT_SETTING)}, true)
     AND team_id = current_setting(${quoteLiteral(PG_TEAM_SETTING)}, true)`,
    ),
    // The child tables carry no team column; their project_id is a FK onto a
    // `projects` row the caller already proved membership of.
    ...isolate("project_versions", scopedToProject),
    ...isolate("project_sunsets", scopedToProject),

    ...PG_READABLE_TABLES.map(
      (table) => `GRANT SELECT ON ${table} TO ${role}`,
    ),
  ];
}

/** Statements carrying the role password, which must never be logged. */
function isSecretStatement(statement: string): boolean {
  return statement.includes("PASSWORD");
}

const READ_ONLY_PREFIX = /^\s*(?:select|with)\b/i;

/**
 * Rejects anything that is not a single read before it reaches the server.
 *
 * This is defence in depth, not the security boundary — the role holds only
 * SELECT and the transaction is `READ ONLY`, so a write fails regardless. It
 * exists to turn a model-authored `UPDATE` into an immediate, legible error
 * instead of a Postgres privilege message, and to stop a trailing statement
 * from riding along on a semicolon.
 */
export function assertReadOnlyStatement(query: string): void {
  const trimmed = query.trim();
  if (!READ_ONLY_PREFIX.test(trimmed)) {
    throw new ProjectPgQueryError(
      "Only SELECT and WITH queries are allowed on this endpoint.",
    );
  }
  const withoutTrailing = trimmed.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new ProjectPgQueryError(
      "Only a single statement is allowed per query.",
    );
  }
}

let pool: ReturnType<typeof createRestrictedPool> | undefined;
let accessReady: Promise<void> | undefined;

function queryPassword(): string {
  return env.POSTGRES_QUERY_PASSWORD;
}

function getPool() {
  pool ??= createRestrictedPool({
    databaseUrl: env.DATABASE_URL,
    role: PG_QUERY_ROLE,
    password: queryPassword(),
  });
  return pool;
}

/**
 * Provisioning runs as the table owner, which is the app's ordinary
 * connection. Imported lazily: `@versionless/db` builds its client at module
 * load from `DATABASE_URL`, and this module is reachable from the error policy,
 * which unit tests import with validation skipped and no database configured.
 */
async function ownerClient(): Promise<PgCommandClient> {
  const { db } = await import("@versionless/db");
  const { sql } = await import("drizzle-orm");
  return {
    async query(text: string) {
      return db.execute(sql.raw(text));
    },
  };
}

export async function provisionPgQueryAccess(
  client?: PgCommandClient,
  password = queryPassword(),
): Promise<void> {
  const target = client ?? (await ownerClient());
  for (const statement of pgQueryAccessStatements(password)) {
    try {
      await target.query(statement);
    } catch (error) {
      // Re-thrown without the statement when it carries the password, so a
      // provisioning failure cannot print the credential into a server log.
      // The driver error is deliberately not retained as a cause: Drizzle
      // errors include the full SQL statement in a `query` property.
      throw isSecretStatement(statement)
        ? new Error(
            `Postgres query access provisioning failed on a role statement`,
          )
        : error;
    }
  }
}

export function ensurePgQueryAccess(): Promise<void> {
  accessReady ??= provisionPgQueryAccess().catch((error) => {
    // Cleared so a transient failure (database still starting) is retried on
    // the next request instead of poisoning the process.
    accessReady = undefined;
    throw new ProjectPgQueryUnavailableError(
      safePostgresError(error, env.NODE_ENV === "development"),
      { cause: error },
    );
  });
  return accessReady;
}

/** Exposed for tests; resets the memoized provisioning and pool. */
export function resetPgQueryAccess(): void {
  accessReady = undefined;
  pool = undefined;
}

export async function executeProjectPgQuery(
  input: ProjectPgQueryInput,
  dependencies: {
    ensureAccess?: () => Promise<void>;
    pool?: RestrictedPgQueryPool;
    isDevelopment?: boolean;
  } = {},
): Promise<ProjectPgQueryResult> {
  assertReadOnlyStatement(input.query);

  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS, 1_000),
    MAX_QUERY_TIMEOUT_MS,
  );
  await (dependencies.ensureAccess ?? ensurePgQueryAccess)();
  const queryId = `${input.projectId}:${randomUUID()}`;
  const client = await (dependencies.pool ?? getPool()).connect();

  try {
    // READ ONLY is the transaction-level guarantee behind the prefix check:
    // even a read that reaches a volatile write function is refused. Both the
    // timeout and the tenancy GUCs are SET LOCAL / set_config(..., true), so
    // they expire with the transaction and cannot leak onto the next borrower
    // of this pooled connection.
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    await client.query("SELECT set_config($1, $2, true)", [
      PG_PROJECT_SETTING,
      input.projectId,
    ]);
    await client.query("SELECT set_config($1, $2, true)", [
      PG_TEAM_SETTING,
      input.teamId,
    ]);

    const statement = input.query.trim().replace(/;\s*$/, "");
    // Apply the cap in Postgres rather than after node-postgres has materialized
    // the whole result. The transaction and restricted role remain the security
    // boundary; this outer SELECT is the resource bound.
    const boundedQuery = `SELECT *
FROM (
${statement}
) AS versionless_bounded_query
LIMIT ${MAX_RESULT_ROWS}`;
    const { rows } = await client.query(boundedQuery, input.params ?? []);
    await client.query("ROLLBACK");

    return {
      // Defensive only: a test double or unusual driver must not widen the
      // public contract even if it ignores the SQL LIMIT.
      result: (rows as Record<string, unknown>[]).slice(0, MAX_RESULT_ROWS),
      queryId,
    };
  } catch (error) {
    // A failed statement leaves the transaction aborted; roll back so the
    // connection returns to the pool usable.
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ProjectPgQueryError) throw error;
    throw new ProjectPgQueryError(
      safePostgresError(error, dependencies.isDevelopment),
      { cause: error },
    );
  } finally {
    client.release();
  }
}
