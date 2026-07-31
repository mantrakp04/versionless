/**
 * Endpoints of the docker-compose stack in `docker-compose.yml`, shared so dev
 * defaults and dev-only tooling cannot drift from the ports it publishes.
 *
 * Every port comes from `PORT_PREFIX` (see `./ports`), so a second worktree
 * can run the whole stack next to the first with `PORT_PREFIX=31`. Set it in
 * the shell — docker compose and the dev processes must both see it.
 *
 * `server.ts` applies these only outside production, where a missing URL must
 * still fail validation loudly. Dev/CI scripts that never run in production
 * (drizzle config, query validation) use them as a plain fallback.
 */
// Self-referenced through the package's own export map rather than "./ports":
// Node loads this file directly (vite.config.ts, drizzle.config.ts) and its
// ESM resolver rejects extensionless relative specifiers.
import {
  resolveLocalUrls,
  resolvePortPrefix,
  resolvePorts,
} from "@versionless/env/ports";

export const localPortPrefix = resolvePortPrefix(process.env.PORT_PREFIX);
export const localPorts = resolvePorts(localPortPrefix);

const urls = resolveLocalUrls(localPorts);

export const localServerUrl = urls.server;
export const localCorsOrigin = urls.dashboard;
export const localDocsUrl = urls.docs;
export const localDatabaseUrl = urls.database;
export const localClickhouseUrl = urls.clickhouse;
export const localOtlpLogsUrl = urls.otlpLogs;
export const localCollectorUrl = urls.collectorHttp;
