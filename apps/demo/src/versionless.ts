import { createVersionless, rateSample } from "@versionless/core";
import { env } from "@versionless/env/demo";
import { localOtlpLogsUrl } from "@versionless/env/local";

export const CURRENT_VERSION = "2026-07-21";

/**
 * The demo's versionless instance. The demo app dogfoods the full opt-in
 * telemetry loop: its apiKey is a Hexclave team API key for the demo team,
 * pointed at the versionless cloud OTLP gateway, so real button clicks show
 * up on the demo team's dashboard in apps/dashboard.
 */
export const v = createVersionless({
  project: "versionless demo API",
  scheme: "date",
  current: CURRENT_VERSION,
  resolve: [{ header: "x-api-version" }, { default: "current" }],
  // Opt-in cloud telemetry. Without a key, zero network calls.
  apiKey: env.DEMO_VERSIONLESS_API_KEY ?? env.VERSIONLESS_API_KEY,
  apiUrl: env.VERSIONLESS_API_URL,
  // Falls back to this checkout's own gateway, so a worktree running on its
  // own PORT_PREFIX block does not ship telemetry into a sibling's stack.
  otlpLogsUrl:
    env.VERSIONLESS_OTLP_LOGS_URL ??
    (env.NODE_ENV === "development" ? localOtlpLogsUrl : undefined),
  // Cheap deterministic sampling on the event timestamp.
  sample: rateSample(env.TELEMETRY_SAMPLE_RATE),
  // Cloud trace capture dogfoods too (head sampling to /v1/traces, derived
  // from otlpLogsUrl).
  traces: {},
});

// The floor version predates every change; it only exists as a pin target and
// sunset anchor so the dashboard has a real "can I sunset this?" story.
v.sunset("2025-01-01", {
  after: "2026-12-31",
  message: "API versions from 2025-01-01 and earlier sunset on 2026-12-31.",
});
