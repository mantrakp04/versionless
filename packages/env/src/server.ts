import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { getVercelOrigin } from "./vercel";

const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
  ...process.env,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? vercelOrigin,
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
    AI_BASE_URL: z.url().default("http://localhost:8317/v1"),
    AI_API_KEY: z.string().optional(),
    /** Model used when the client does not pick one from `/v1/chat/models`. */
    AI_MODEL: z.string().optional(),
    TELEMETRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    VERSIONLESS_INGEST_KEYS: z.string().optional(),
    VERSIONLESS_API_KEY: z.string().optional(),
    VERSIONLESS_API_URL: z.url().optional(),
    VERSIONLESS_OTLP_LOGS_URL: z.url().optional(),
    RUN_MIGRATIONS: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(3000),
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
