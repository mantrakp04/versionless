import { HexclaveClientApp } from "@hexclave/react";
import { env } from "@versionless/env/web";

export const hexclaveClientApp = new HexclaveClientApp({
  projectId: env.VITE_HEXCLAVE_PROJECT_ID,
  publishableClientKey: env.VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  urls: {
    default: {
      type: "hosted",
    },
  },
});
