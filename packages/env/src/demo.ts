import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Opt-in cloud telemetry: a Hexclave team API key for the demo team.
    // Without a key, the demo makes zero telemetry network calls.
    // DEMO_VERSIONLESS_API_KEY wins over the shared name — the Vercel project
    // holds env vars for every service, and apps/server's own key also lives
    // under VERSIONLESS_API_KEY.
    DEMO_VERSIONLESS_API_KEY: z.string().optional(),
    VERSIONLESS_API_KEY: z.string().optional(),
    VERSIONLESS_API_URL: z.url().optional(),
    VERSIONLESS_OTLP_LOGS_URL: z.url().optional(),
    TELEMETRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
