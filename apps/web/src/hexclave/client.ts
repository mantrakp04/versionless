import { HexclaveClientApp } from "@hexclave/react";
import { env } from "@versionless/env/web";

export const hexclaveClientApp = new HexclaveClientApp({
  projectId: env.VITE_HEXCLAVE_PROJECT_ID,
  tokenStore: "cookie",
  urls: {
    handler: "/handler",
  },
});
