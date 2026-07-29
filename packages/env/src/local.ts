/**
 * Endpoints of the docker-compose stack in `docker-compose.yml`, shared so dev
 * defaults and dev-only tooling cannot drift from the ports it publishes.
 *
 * `server.ts` applies these only outside production, where a missing URL must
 * still fail validation loudly. Dev/CI scripts that never run in production
 * (drizzle config, query validation) use them as a plain fallback.
 */
export const localCorsOrigin = "http://localhost:3001";
export const localDatabaseUrl =
  "postgresql://postgres:password@localhost:5432/versionless";
export const localClickhouseUrl =
  "http://clickhouse:password@localhost:8123/versionless";
