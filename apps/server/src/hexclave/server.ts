import { HexclaveServerApp } from "@hexclave/js";
import { env } from "@versionless/env/server";

export const hexclaveServerApp = new HexclaveServerApp({
  projectId: env.HEXCLAVE_PROJECT_ID,
  publishableClientKey: env.HEXCLAVE_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: env.HEXCLAVE_SECRET_SERVER_KEY,
  tokenStore: null,
  urls: {
    default: {
      type: "hosted",
    },
  },
});
