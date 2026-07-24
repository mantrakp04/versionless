import { createVersionless, rateSample } from "@versionless/core";
import { env } from "@versionless/env/server";

export const CURRENT_VERSION = "2026-07-24";

const sampleByRate = rateSample(env.TELEMETRY_SAMPLE_RATE);

if (
  env.NODE_ENV === "production" &&
  (!env.VERSIONLESS_API_KEY || !env.VERSIONLESS_OTLP_LOGS_URL)
) {
  console.warn(
    "[versionless] cloud telemetry is disabled: API key or OTLP logs URL is missing",
  );
}

/**
 * The cloud server's own versionless instance — apps/server dogfoods the
 * product on its own service API (query plane + dashboard tRPC) under the
 * owning team's "internal" project. Its apiKey is a Hexclave team API key for
 * that team; the OTLP endpoint is the local gateway in dev and the deployed
 * gateway in prod via VERSIONLESS_OTLP_LOGS_URL. No changes are registered
 * yet: the surface snapshot in apps/server/.versionless is the contract
 * `check` guards while the chain is empty.
 */
export const v = createVersionless({
  project: "internal",
  scheme: "date",
  current: CURRENT_VERSION,
  resolve: [{ header: "x-api-version" }, { default: "current" }],
  // Opt-in cloud telemetry: the server's own key points at its own Collector
  // gateway. Without a key, zero network calls.
  apiKey: env.VERSIONLESS_API_KEY,
  // The production cloud server runs as Vercel Functions. Set this explicitly
  // because multi-service bundles do not reliably expose VERCEL at module init.
  serverless: env.NODE_ENV === "production",
  otlpLogsUrl:
    env.VERSIONLESS_OTLP_LOGS_URL ??
    (env.NODE_ENV === "development" ? "http://localhost:4318/v1/logs" : undefined),
  sample: (event) => {
    // Skip the raw HTTP hop of tRPC calls (the tRPC middleware emits the real
    // per-procedure event with a "trpc:" route).
    if (event.route.includes("/trpc") && !event.route.startsWith("trpc:")) return false;
    // Cheap deterministic sampling on the event timestamp.
    return sampleByRate(event);
  },
  traces: {
    filter: (attrs) => {
      const path = String(attrs["versionless.path"] ?? "");
      return !path.startsWith("/trpc");
    },
  },
});
