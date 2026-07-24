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
    // Credentials + database ride in the URL: http://user:pass@host:8123/db
    CLICKHOUSE_URL: z.url().optional(),
    // Separate credential used by the read-only, row-policy-constrained raw
    // query plane. Required in production; development has a local default.
    CLICKHOUSE_QUERY_PASSWORD: z
      .string()
      .min(16)
      .default("versionless-local-query-password"),
    TELEMETRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    VERSIONLESS_INGEST_KEYS: z.string().optional(),
    VERSIONLESS_API_KEY: z.string().optional(),
    VERSIONLESS_OTLP_LOGS_URL: z.url().optional(),
    RUN_MIGRATIONS: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    // Platform flags: VERCEL is set by the Vercel runtime, VERSIONLESS by the
    // versionless CLI while importing the app for surface extraction.
    VERCEL: z.string().optional(),
    VERSIONLESS: z.string().optional(),
    // Knobs for apps/server/scripts/seed-traffic.ts only.
    SEED_TEAM_ID: z.string().optional(),
    SEED_ADMIN_ACCOUNT: z.email().optional(),
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
