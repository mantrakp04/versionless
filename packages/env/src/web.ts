import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { env as viteEnv } from "./vite";

const serverUrlSchema = z.union([
  z.url(),
  z.string().regex(/^\/(?!\/)/, "Use an absolute URL or a same-origin path like /api"),
]);

type RuntimeEnv = Record<string, string | number | boolean | undefined>;

const runtimeEnv: RuntimeEnv =
  (import.meta as { env?: RuntimeEnv }).env ?? {};

export const env = createEnv({
  extends: [viteEnv],
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: serverUrlSchema,
    VITE_HEXCLAVE_PROJECT_ID: z.string().min(1),
  },
  runtimeEnv,
  // Read the skip flag from import.meta.env, not process.env: this module is
  // bundled for the browser, where `process` does not exist.
  skipValidation: !!runtimeEnv.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
