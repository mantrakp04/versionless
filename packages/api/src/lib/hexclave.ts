import { HexclaveServerApp } from "@hexclave/js";
import { env } from "@versionless/env/server";

let app: HexclaveServerApp | null | undefined;

/**
 * Lazy singleton. Env validation can be skipped (SKIP_ENV_VALIDATION=1 in
 * tests/CI), in which case auth-dependent features degrade to "not signed in"
 * instead of crashing at import time.
 */
export function getHexclaveServerApp(): HexclaveServerApp | null {
  if (app !== undefined) return app;
  if (!env.HEXCLAVE_PROJECT_ID || !env.HEXCLAVE_SECRET_SERVER_KEY) {
    app = null;
    return app;
  }
  app = new HexclaveServerApp({
    projectId: env.HEXCLAVE_PROJECT_ID,
    secretServerKey: env.HEXCLAVE_SECRET_SERVER_KEY,
    tokenStore: null,
    urls: {
      default: {
        type: "hosted",
      },
    },
  });
  return app;
}
