import { HexclaveServerApp } from "@hexclave/js";
import { env } from "@versionless/env/server";

export const hexclaveServerApp = new HexclaveServerApp({
  projectId: env.HEXCLAVE_PROJECT_ID,
  secretServerKey: env.HEXCLAVE_SECRET_SERVER_KEY,
  tokenStore: null,
  urls: {
    default: {
      type: "hosted",
    },
  },
});
