/**
 * Seeds ~30 days of synthetic versionless telemetry through the trusted
 * local Collector port
 * so the insights dashboard has a story to tell on first run: adoption of
 * 2026-05-14 visibly overtakes 2025-06-01, while two stubborn consumers stay
 * pinned on 2025-01-01 (the sunset blockers). Every dashboard range (24h, 7d,
 * and 30d) has traffic so the overview filters remain useful.
 *
 * Usage:  bun db:start          (ClickHouse container)
 *         bun run seed          (from apps/server)
 *
 * The dashboard links projects to the account that owns the API key, so the
 * seed must land under your team id. Resolution order:
 *   1. SEED_TEAM_ID              — explicit override (copy from the /keys page)
 *   2. SEED_ADMIN_ACCOUNT        — your Hexclave account email; the script asks
 *                                  Hexclave for that user and always seeds under
 *                                  the first team returned for the account
 *   3. "demo"                    — placeholder team nobody's dashboard shows
 *
 *         SEED_ADMIN_ACCOUNT=you@example.com bun run seed
 *         SEED_TEAM_ID=<teamId> SEED_PROJECT_NAME=demo-api bun run seed
 */
import { getHexclaveServerApp } from "@versionless/api/lib/hexclave";
import {
  capturedTracesToOtlp,
  telemetryEventsToOtlp,
  type CapturedSpan,
  type CapturedTrace,
  type OtlpKeyValue,
  type TelemetryEvent,
} from "@versionless/core";
import { db } from "@versionless/db";
import { projects } from "@versionless/db/schema/projects";
import { env } from "@versionless/env/server";
import { KNOWN_VERSIONS } from "demo/releases";
import { createDemoSeedRoutes } from "demo/seed-fixtures";
import { randomBytes } from "node:crypto";
import { resolveSeedTeam } from "../src/seed-team";
const COLLECTOR_URL = "http://127.0.0.1:14318";
const TEAM_ID = await resolveTeamId();
const PROJECT_NAME = env.SEED_PROJECT_NAME ?? "versionless demo API";

// "internal" is the cloud server's own live telemetry project
// (@versionless/api/versionless) — synthetic preview data must never land
// there, or the team's real dashboard story gets polluted.
if (PROJECT_NAME === "internal") {
  throw new Error(
    'refusing to seed the "internal" project — it holds apps/server\'s real telemetry; pick a different SEED_PROJECT_NAME',
  );
}

async function resolveTeamId(): Promise<string> {
  const hexclave =
    !env.SEED_TEAM_ID && env.SEED_ADMIN_ACCOUNT
      ? getHexclaveServerApp()
      : undefined;
  const resolution = await resolveSeedTeam({
    explicitTeamId: env.SEED_TEAM_ID,
    adminEmail: env.SEED_ADMIN_ACCOUNT,
    listUsers: hexclave
      ? (email) => hexclave.listUsers({ query: email })
      : undefined,
  });
  if (resolution.source === "admin-account-first-team") {
    console.log(
      `Seeding under ${resolution.email}'s first team "${resolution.team.displayName}" (${resolution.team.id}); dashboard team selection is ignored`,
    );
  }
  return resolution.teamId;
}

const [project] = await db
  .insert(projects)
  .values({ teamId: TEAM_ID, name: PROJECT_NAME })
  .onConflictDoUpdate({
    target: [projects.teamId, projects.name],
    set: { lastSeenAt: new Date() },
  })
  .returning({ id: projects.id });
if (!project) throw new Error("Failed to create seed project");
const PROJECT_ID = project.id;

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const ROUTES = createDemoSeedRoutes();

interface Consumer {
  key: string;
  /** version per day-offset: tells the migration story */
  versionAt(daysAgo: number): string;
  requestsPerDay: number;
}

// Six consumers: two migrate mid-window, two were always current-ish, two are
// stuck on the sunset-scheduled floor (the blockers).
const consumers: Consumer[] = [
  { key: "key_acme", requestsPerDay: 40, versionAt: (d) => (d > 12 ? "2025-06-01" : "2026-05-14") },
  { key: "key_globex", requestsPerDay: 30, versionAt: (d) => (d > 6 ? "2025-06-01" : "2026-05-14") },
  { key: "key_initech", requestsPerDay: 25, versionAt: () => "2026-05-14" },
  { key: "key_hooli", requestsPerDay: 20, versionAt: (d) => (d > 20 ? "2026-05-14" : "2026-07-21") },
  { key: "key_stuck_legacy", requestsPerDay: 8, versionAt: () => "2025-01-01" },
  { key: "key_stuck_batch", requestsPerDay: 4, versionAt: () => "2025-01-01" },
];

// Deterministic pseudo-random so re-seeding produces a similar shape.
let seed = 42;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
}

const events: TelemetryEvent[] = [];
for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
  for (const consumer of consumers) {
    const version = consumer.versionAt(daysAgo);
    const count = Math.max(1, Math.round(consumer.requestsPerDay * (0.7 + rand() * 0.6)));
    for (let i = 0; i < count; i++) {
      const routeInfo = ROUTES[Math.floor(rand() * ROUTES.length)]!;
      const depth = routeInfo.depthByVersion[version as keyof typeof routeInfo.depthByVersion] ?? 0;
      events.push({
        // Keep every synthetic timestamp in the past. Adding the intra-day
        // offset made day-zero rows land in the future and crowd out current
        // arbitrary OTLP records from the Telemetry feed.
        ts: now - daysAgo * DAY - Math.floor(rand() * DAY * 0.9),
        method: routeInfo.method,
        route: routeInfo.route,
        adapter: routeInfo.adapter,
        version,
        consumerKey: consumer.key,
        latencyMs: Math.round(3 + rand() * 40 + depth * 2),
        transformCount: depth,
        status: rand() < 0.97 ? 200 : 404,
      });
    }
  }
}

// Sampled traces mirror the SDK's cloud trace capture (default 10% head
// sampling): a subset of the last week's events also get a versionless span
// tree — exchange root, resolve, and one transform.down span per drift step —
// so the Traces insights view has data. The seed emits the same native OTLP
// span attributes as the SDK and lets the Collector own ClickHouse mapping.
const TRACE_SAMPLE = 0.1;
const traces: CapturedTrace[] = [];
let traceCounter = 0;
const traceRunPrefix = randomBytes(12).toString("hex");

for (const event of events) {
  const daysOld = (now - event.ts) / DAY;
  // Only past events within the last week: the traces list sorts by recency
  // and future-dated rows (day-0 events land anywhere in today) read wrong.
  if (daysOld < 0 || daysOld > 7 || rand() >= TRACE_SAMPLE) continue;
  const traceId = `${traceRunPrefix}${(traceCounter++)
    .toString(16)
    .padStart(8, "0")}`;
  const traceSpans: CapturedSpan[] = [];
  const failed = event.status >= 400 && rand() < 0.5;

  traceSpans.push({
    spanId: "0000000000000001",
    name: "versionless.exchange",
    startMs: event.ts,
    durationMs: event.latencyMs + rand(),
    attrs: {
      "versionless.adapter": event.adapter,
      "versionless.method": event.method,
      "versionless.route": event.route,
      "versionless.version": event.version,
      "versionless.status": event.status,
      "versionless.transform_count": event.transformCount,
    },
  });
  traceSpans.push({
    spanId: "0000000000000002",
    parentSpanId: "0000000000000001",
    name: "versionless.resolve",
    startMs: event.ts,
    durationMs: 0.05 + rand() * 0.2,
    attrs: {
      "versionless.version.source": "header",
      "versionless.version": event.version,
    },
  });
  // One down-transform span per drift step, newest change first.
  const changes = KNOWN_VERSIONS.filter((v) => v > event.version).reverse();
  let offset = 1 + rand() * 2;
  for (let step = 0; step < event.transformCount; step++) {
    const change = changes[step % Math.max(1, changes.length)] ?? "2026-07-21";
    const isLast = step === event.transformCount - 1;
    traceSpans.push({
      spanId: (step + 3).toString(16).padStart(16, "0"),
      parentSpanId: "0000000000000001",
      name: "versionless.transform.down",
      startMs: event.ts + Math.round(offset),
      durationMs: 0.1 + rand() * 0.8,
      attrs: { "versionless.change": change, "versionless.route": event.route },
      ...(failed && isLast
        ? { error: `TransformError: down(${change}) on ${event.route}` }
        : {}),
    });
    offset += 0.5 + rand() * 1.5;
  }
  traces.push({ traceId, spans: traceSpans });
}

function trustedResource(attributes: OtlpKeyValue[]): OtlpKeyValue[] {
  return [
    ...attributes,
    {
      key: "versionless.team.id",
      value: { stringValue: TEAM_ID },
    },
    {
      key: "versionless.project.id",
      value: { stringValue: PROJECT_ID },
    },
  ];
}

async function post(signal: "logs" | "traces", body: unknown): Promise<void> {
  const response = await fetch(`${COLLECTOR_URL}/v1/${signal}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Collector ${signal} ingest failed (${response.status}): ${await response.text()}`,
    );
  }
}

const LOG_BATCH = 500;
for (let offset = 0; offset < events.length; offset += LOG_BATCH) {
  const request = telemetryEventsToOtlp(
    PROJECT_NAME,
    events.slice(offset, offset + LOG_BATCH),
  );
  const resource = request.resourceLogs[0]!.resource!;
  resource.attributes = trustedResource(resource.attributes ?? []);
  await post("logs", request);
}

const arbitraryTraceId = randomBytes(16).toString("hex");
const arbitrarySpanId = randomBytes(8).toString("hex");
const arbitraryLog = telemetryEventsToOtlp("checkout-worker", []);
arbitraryLog.resourceLogs[0]!.resource!.attributes = trustedResource([
  { key: "service.name", value: { stringValue: "checkout-worker" } },
  {
    key: "deployment.environment.name",
    value: { stringValue: "local" },
  },
]);
arbitraryLog.resourceLogs[0]!.scopeLogs = [
  {
    scope: { name: "@opentelemetry/instrumentation-http", version: "1.0.0" },
    logRecords: [
      {
        timeUnixNano: (BigInt(now - 60_000) * 1_000_000n).toString(),
        observedTimeUnixNano: (BigInt(now - 59_950) * 1_000_000n).toString(),
        severityNumber: 9,
        severityText: "INFO",
        eventName: "checkout.completed",
        body: { stringValue: "seed checkout completed" },
        attributes: [
          { key: "order.id", value: { stringValue: "order_seed_42" } },
          { key: "item.count", value: { intValue: "3" } },
        ],
        traceId: arbitraryTraceId,
        spanId: arbitrarySpanId,
      },
    ],
  },
];
await post("logs", arbitraryLog);

const TRACE_BATCH = 100;
let spanCount = 0;
for (let offset = 0; offset < traces.length; offset += TRACE_BATCH) {
  const request = capturedTracesToOtlp(
    PROJECT_NAME,
    traces.slice(offset, offset + TRACE_BATCH),
  );
  const resource = request.resourceSpans[0]!.resource!;
  resource.attributes = trustedResource(resource.attributes ?? []);
  spanCount += request.resourceSpans[0]!.scopeSpans[0]!.spans.length;
  await post("traces", request);
}

const arbitraryTrace = capturedTracesToOtlp("checkout-worker", [
  {
    traceId: arbitraryTraceId,
    spans: [
      {
        spanId: arbitrarySpanId,
        name: "POST payments.example.test/charge",
        startMs: now - 60_200,
        durationMs: 200,
        attrs: {
          "http.request.method": "POST",
          "server.address": "payments.example.test",
        },
      },
    ],
  },
]);
arbitraryTrace.resourceSpans[0]!.resource!.attributes = trustedResource([
  { key: "service.name", value: { stringValue: "checkout-worker" } },
]);
await post("traces", arbitraryTrace);
spanCount++;

console.log(
  `Done — ${events.length + 1} logs and ${traces.length + 1} traces (${spanCount} spans) written through the Collector. Open the dashboard: http://localhost:3001/insights`,
);
