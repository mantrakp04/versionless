import { Pool, type PoolClient } from "pg";

/**
 * Connection primitive for the read-only query plane. It lives here because
 * `pg` is a dependency of this package; the policy that decides what the
 * restricted role may see (RLS, timeouts, row caps, error scrubbing) belongs
 * to `@versionless/api`, which imports only this factory.
 */

export interface RestrictedPgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

export interface RestrictedPgPool {
  connect(): Promise<RestrictedPgClient>;
}

/**
 * Builds a pool that reaches the same database as `DATABASE_URL` but
 * authenticates as `role` instead of the owner. `connectionString` is parsed
 * first, then user/password are overwritten — pg applies explicit config keys
 * over the parsed string, so a credential embedded in the URL cannot leak
 * back in and hand the query plane owner privileges.
 */
export function createRestrictedPool(input: {
  databaseUrl: string;
  role: string;
  password: string;
  max?: number;
}): Pool {
  return new Pool({
    connectionString: input.databaseUrl,
    user: input.role,
    password: input.password,
    max: input.max ?? 4,
    // A query-plane connection is request-scoped and bursty; holding idle
    // sockets open against a role that may be revoked is not worth it.
    idleTimeoutMillis: 30_000,
    // Fail fast rather than queueing behind an unreachable database while an
    // HTTP request waits on it.
    connectionTimeoutMillis: 5_000,
    application_name: "versionless_query",
  });
}

export type { Pool as PgPool, PoolClient };
