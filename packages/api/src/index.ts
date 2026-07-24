import { TRPCError, initTRPC } from "@trpc/server";
import {
  versionlessErrorFormatter,
  versionlessMiddleware,
} from "@versionless/adapter-trpc";

import type { Context } from "./context";
import { v } from "./versionless";
import { applyPublicErrorPolicy } from "./error-policy";
import { isDevelopment } from "./lib/env-mode";

const formatVersionlessError = versionlessErrorFormatter(v);
export const t = initTRPC.context<Context>().create({
  // Error shapes are versioned too: changes with `error: { down }` apply to
  // the error envelope for pinned clients (sync transforms only).
  errorFormatter: (options) =>
    applyPublicErrorPolicy(formatVersionlessError(options), isDevelopment),
});

export const router = t.router;

// Every procedure goes through the versionless middleware: it opens the
// per-procedure exchange and emits the `trpc:<path>` telemetry event. The
// instance's `sample` drops the raw /trpc HTTP hop on the assumption that
// these per-procedure events exist — without this, dashboard traffic would
// be invisible to the server's own telemetry.
export const publicProcedure = t.procedure.use(versionlessMiddleware());

/** Requires a signed-in Hexclave user; adds `ctx.user` (ServerUser). */
export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const user = await ctx.getUser();
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
  }
  return next({ ctx: { user } });
});
