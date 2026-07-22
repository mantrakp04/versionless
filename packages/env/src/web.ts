import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const serverUrlSchema = z.union([
  z.url(),
  z.string().regex(/^\/(?!\/)/, "Use an absolute URL or a same-origin path like /api"),
]);

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: serverUrlSchema,
    VITE_HEXCLAVE_PROJECT_ID: z.string().min(1),
    VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY: z.string().min(1),
  },
  runtimeEnv: (import.meta as any).env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
