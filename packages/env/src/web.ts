import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { resolveLocalUrls, resolvePorts } from "./ports";
import { env as viteEnv } from "./vite";

const serverUrlSchema = z.union([
  z.url(),
  z.string().regex(/^\/(?!\/)/, "Use an absolute URL or a same-origin path like /api"),
]);

type RuntimeEnv = Record<string, string | number | boolean | undefined>;

const runtimeEnv: RuntimeEnv =
  (import.meta as { env?: RuntimeEnv }).env ?? {};

// PORT_PREFIX reaches the bundle through each Vite config's `envPrefix`, so
// one shell variable moves the whole worktree's stack — including the sibling
// apps this one links to in dev.
const localUrls = resolveLocalUrls(
  resolvePorts(runtimeEnv.PORT_PREFIX as string | undefined),
);

const isDevelopment =
  runtimeEnv.DEV === true || runtimeEnv.MODE === "development";

/**
 * Dev-only links to sibling apps, which are separate origins until the Vercel
 * service router puts them behind one. Deployed builds use same-origin paths.
 */
export const devUrls = {
  server: localUrls.server,
  docs: `${localUrls.docs}/docs`,
  dashboard: `${localUrls.dashboard}/dashboard`,
};

// Local Vite dev talks to apps/server on its prefixed port. Deployed builds are
// same-origin: vercel.json routes /api to the server service, and getServerUrl
// resolves a leading-slash path against the current origin.
const defaultServerUrl = isDevelopment ? devUrls.server : "/api";

const resolvedRuntimeEnv: RuntimeEnv = {
  ...runtimeEnv,
  // Resolve before createEnv so SKIP_ENV_VALIDATION still sees the default.
  VITE_SERVER_URL: runtimeEnv.VITE_SERVER_URL || defaultServerUrl,
};

export const env = createEnv({
  extends: [viteEnv],
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: serverUrlSchema,
    VITE_HEXCLAVE_PROJECT_ID: z.string().min(1),
  },
  runtimeEnv: resolvedRuntimeEnv,
  // Read the skip flag from import.meta.env, not process.env: this module is
  // bundled for the browser, where `process` does not exist.
  skipValidation: !!runtimeEnv.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
