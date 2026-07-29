import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Vite-injected build constants (`import.meta.env.DEV`, `BASE_URL`) for any
 * Vite-bundled app — the dashboard and the demo client routes. Lives in
 * `@versionless/env` so raw `import.meta.env` reads stay inside this package.
 * The defaults cover non-Vite runtimes (bun test), where these constants are
 * not injected.
 */
type RuntimeEnv = Record<string, string | number | boolean | undefined>;

const viteRuntimeEnv: RuntimeEnv =
  (import.meta as { env?: RuntimeEnv }).env ?? {};

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {},
  shared: {
    DEV: z.boolean().default(false),
    BASE_URL: z.string().default("/"),
  },
  runtimeEnv: viteRuntimeEnv,
  skipValidation: !!viteRuntimeEnv.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
