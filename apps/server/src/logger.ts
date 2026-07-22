import { createError, initLogger, parseError } from "evlog";
import { evlog, useLogger } from "evlog/elysia";

initLogger({
  env: {
    service: "versionless",
  },
});

export const evlogPlugin = evlog();
export { createError, parseError, useLogger };
