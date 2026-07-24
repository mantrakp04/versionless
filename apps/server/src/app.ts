import { cors } from "@elysiajs/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { versionlessResponseMeta } from "@versionless/adapter-trpc";
import { createContext } from "@versionless/api/context";
import { getHexclaveServerApp } from "@versionless/api/lib/hexclave";
import { appRouter } from "@versionless/api/routers/index";
import { v } from "@versionless/api/versionless";
import { env } from "@versionless/env/server";
import { waitUntil } from "@vercel/functions";
import { consoleSink } from "@versionless/core";
import {
  finishVersionlessResponse,
  versionless,
} from "@versionless/adapter-elysia";
import { Elysia } from "elysia";
import {
  bindTelemetryKey,
  configuredIngestKeys,
  createOtlpAuthApp,
  createOtlpAuthorizer,
  resolveTelemetryProject,
} from "./ingest";
import { evlogPlugin } from "./logger";
import { projectQueryApp } from "./query";

const ingestKeys = configuredIngestKeys(
  env.VERSIONLESS_INGEST_KEYS,
  env.NODE_ENV,
);

/**
 * Validates dashboard-created keys (Hexclave team API keys) on ingest.
 * A valid key resolves to its owning team id. The ingest route then resolves
 * the constructor's project name under that account before storing events.
 * Results are cached so a chatty SDK doesn't turn every batch into a
 * Hexclave round-trip.
 */
function hexclaveKeyVerifier(): ((bearer: string) => Promise<string | null>) | undefined {
  const hexclave = getHexclaveServerApp();
  if (!hexclave) return undefined;
  const cache = new Map<string, { teamId: string | null; expires: number }>();
  return async (bearer) => {
    const hit = cache.get(bearer);
    if (hit && hit.expires > Date.now()) return hit.teamId;
    const team = await hexclave.getTeam({ apiKey: bearer }).catch(() => null);
    const teamId = team?.id ?? null;
    // Positive results cached for a minute; failures briefly, so a revoked
    // key stops working fast but a bad key can't hammer Hexclave either.
    cache.set(bearer, { teamId, expires: Date.now() + (teamId ? 60_000 : 10_000) });
    if (cache.size > 1000) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return teamId;
  };
}

export const otlpAuthorizer = createOtlpAuthorizer({
  keys: ingestKeys,
  verifyExternal: hexclaveKeyVerifier(),
  resolveProject: resolveTelemetryProject,
  bindKey: bindTelemetryKey,
});

// Keep a safe, body-free versionless request line in the platform runtime
// logs as an independent diagnostic alongside the OTLP cloud export.
v.telemetry.use(consoleSink());

// The app is defined here without `.listen()` so it can be imported
// side-effect-free (Vercel functions, tests, and the versionless CLI's
// surface extraction all import this module).
export const app = new Elysia()
  .use(evlogPlugin)
  .use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST", "OPTIONS"],
    }),
  )
  // Envoy calls this metadata-only auth boundary before forwarding raw OTLP
  // HTTP or gRPC to the Collector. Mounted BEFORE the versionless plugin on
  // purpose: versioning the ingest path would loop telemetry into itself.
  .use(createOtlpAuthApp(otlpAuthorizer))
  .use(versionless(v, { waitUntil }))
  // Root-app fallback for Elysia's mounted-plugin lifecycle scoping. The
  // adapter finalizer is idempotent, so direct routes still emit exactly once.
  .onAfterResponse({ as: "global" }, (ctx) =>
    finishVersionlessResponse(ctx, { waitUntil }),
  )
  // The query plane is a real client-facing API — mounted AFTER the plugin
  // (Elysia hooks only apply to routes registered after them) so it gets
  // version resolution and shows up in the server's own telemetry.
  .use(projectQueryApp)
  .all(
    "/trpc/*",
    async (context) => {
      const res = await fetchRequestHandler({
        endpoint: "/trpc",
        router: appRouter,
        req: context.request,
        createContext: () => createContext({ context }),
        responseMeta: versionlessResponseMeta(v),
      });
      return res;
    },
    // tRPC reads the raw Request body itself (mutations); letting Elysia
    // parse it here would consume the stream before fetchRequestHandler runs.
    // The per-procedure versionless middleware handles the up/down transforms.
    { parse: "none" },
  )
  .get("/", () => "OK");
