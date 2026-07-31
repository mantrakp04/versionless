import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import {
  localClickhouseUrl,
  localCorsOrigin,
  localDatabaseUrl,
  localPorts,
} from "./local";
import { getVercelOrigin } from "./vercel";

const isProduction = process.env.NODE_ENV === "production";
const vercelOrigin = getVercelOrigin();
const defaultAiBaseUrl = isProduction
  ? "https://openrouter.ai/api/v1"
  : "http://localhost:8317/v1";
const defaultAiModel = isProduction
  ? "openai/gpt-5.6-luna"
  : "gpt-5.6-luna";
// Local docker-compose / dashboard ports. Production has no fallback beyond
// the Vercel origin for CORS: an unset value must fail validation loudly.
const defaultCorsOrigin = isProduction ? undefined : localCorsOrigin;
const defaultDatabaseUrl = isProduction ? undefined : localDatabaseUrl;
const defaultClickhouseUrl = isProduction ? undefined : localClickhouseUrl;

const runtimeEnv = {
  ...process.env,
  // Resolve dynamic defaults before createEnv so they remain available when
  // SKIP_ENV_VALIDATION returns the raw runtime environment in deployments.
  AI_BASE_URL: process.env.AI_BASE_URL || defaultAiBaseUrl,
  AI_MODEL: process.env.AI_MODEL || defaultAiModel,
  CORS_ORIGIN: process.env.CORS_ORIGIN || vercelOrigin || defaultCorsOrigin,
  DATABASE_URL: process.env.DATABASE_URL || defaultDatabaseUrl,
  CLICKHOUSE_URL: process.env.CLICKHOUSE_URL || defaultClickhouseUrl,
};

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    // Credentials may ride in the URL. Railway also exposes the Collector's
    // database separately, which must win when the public URL has no path.
    CLICKHOUSE_URL: z.url().optional(),
    CLICKHOUSE_DATABASE: z.string().min(1).optional(),
    // Separate credential used by the read-only, row-policy-constrained raw
    // query plane. Required in production; development has a local default.
    CLICKHOUSE_QUERY_PASSWORD: z
      .string()
      .min(16)
      .default("versionless-local-query-password"),
    // Login for the RLS-constrained Postgres role the query plane connects as.
    // Same posture as CLICKHOUSE_QUERY_PASSWORD: required in production, local
    // default in development.
    POSTGRES_QUERY_PASSWORD: z
      .string()
      .min(16)
      .default("versionless-local-pg-query-password"),
    // OpenAI-compatible endpoint backing the dashboard assistant: a local
    // server in development, OpenRouter in production.
    AI_BASE_URL: z.url(),
    AI_API_KEY: z.string().optional(),
    /** Server-selected model backing the dashboard assistant. */
    AI_MODEL: z.string().min(1),
    TELEMETRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    VERSIONLESS_INGEST_KEYS: z.string().optional(),
    VERSIONLESS_API_KEY: z.string().optional(),
    VERSIONLESS_API_URL: z.url().optional(),
    VERSIONLESS_OTLP_LOGS_URL: z.url().optional(),
    RUN_MIGRATIONS: z.string().optional(),
    // Deployments set PORT; locally it follows the PORT_PREFIX block so a
    // second worktree's server does not fight the first for the socket.
    PORT: z.coerce.number().int().positive().default(localPorts.server),
    // Platform flags: VERCEL is set by the Vercel runtime, VERSIONLESS by the
    // versionless CLI while importing the app for surface extraction.
    VERCEL: z.string().optional(),
    VERSIONLESS: z.string().optional(),
    // Knobs for apps/server/scripts/seed-traffic.ts only.
    DEMO_VERSIONLESS_API_KEY: z.string().optional(),
    SEED_TEAM_ID: z.string().optional(),
    SEED_PROJECT_NAME: z.string().optional(),
    CORS_ORIGIN: z.url(),
    HEXCLAVE_PROJECT_ID: z.string().min(1),
    HEXCLAVE_SECRET_SERVER_KEY: z.string().min(1),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: runtimeEnv,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
