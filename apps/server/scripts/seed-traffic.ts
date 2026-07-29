/**
 * Seeds a deterministic, multi-year API release ecosystem through either the
 * authenticated cloud gateway or the trusted local Collector port. The
 * scenario has 50+ dated releases, 100+ endpoints, a few intentionally missing
 * uploaded contracts, long-tail SDK consumers, sticky LTS cohorts, and
 * launch/stable releases with natural popularity spikes. Every dashboard range
 * (24h, 7d, and 30d) has enough traffic to remain useful.
 *
 * Usage:  bun start-deps        (Postgres + ClickHouse + OTel stack)
 *         bun run seed          (from apps/server)
 *
 * The dashboard links projects to the team that owns the API key. Resolution:
 *   1. DEMO_VERSIONLESS_API_KEY — Hexclave resolves the authoritative demo team
 *   2. SEED_TEAM_ID             — trusted local-Collector override
 *   3. "demo"                   — hidden local fallback
 *
 * Set VERSIONLESS_OTLP_LOGS_URL with DEMO_VERSIONLESS_API_KEY to seed through
 * the cloud gateway. Without both, the script uses the local Collector.
 */
import { getHexclaveServerApp } from "@versionless/api/lib/hexclave";
import {
  capturedTracesToOtlp,
  DEFAULT_TRACE_SAMPLE,
  telemetryEventsToOtlp,
  type CapturedSpan,
  type CapturedTrace,
  type OtlpKeyValue,
  type TelemetryEvent,
} from "@versionless/core";
import { db } from "@versionless/db";
import {
  projects,
  projectSunsets,
  projectVersions,
} from "@versionless/db/schema/projects";
import { env } from "@versionless/env/server";
import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { resolveSeedTeam } from "../src/seed-team";
import { createSeedScenario } from "./seed-scenario";
import { postSeedBatch } from "./seed-transport";
const LOCAL_COLLECTOR_URL = "http://127.0.0.1:14318";
const GATEWAY_LOGS_URL = env.VERSIONLESS_OTLP_LOGS_URL;
const DEMO_API_KEY = env.DEMO_VERSIONLESS_API_KEY;
const USE_AUTHENTICATED_GATEWAY = Boolean(GATEWAY_LOGS_URL && DEMO_API_KEY);
const OTLP_BASE_URL = USE_AUTHENTICATED_GATEWAY
  ? GATEWAY_LOGS_URL!.replace(/\/v1\/logs\/?$/, "")
  : LOCAL_COLLECTOR_URL;
const TEAM_ID = await resolveTeamId();
const PROJECT_NAME = env.SEED_PROJECT_NAME ?? "versionless demo API";
const now = Date.now();
const scenario = createSeedScenario({ now });

// "internal" is the cloud server's own live telemetry project
// (@versionless/api/versionless) — synthetic preview data must never land
// there, or the team's real dashboard story gets polluted.
if (PROJECT_NAME === "internal") {
  throw new Error(
    'refusing to seed the "internal" project — it holds apps/server\'s real telemetry; pick a different SEED_PROJECT_NAME',
  );
}

async function resolveTeamId(): Promise<string> {
  const hexclave = DEMO_API_KEY ? getHexclaveServerApp() : undefined;
  const resolution = await resolveSeedTeam({
    demoApiKey: DEMO_API_KEY,
    explicitTeamId: env.SEED_TEAM_ID,
    resolveApiKeyTeam: hexclave
      ? async (apiKey) => {
          const team = await hexclave.getTeam({ apiKey }).catch(() => null);
          return team ? { id: team.id, displayName: team.displayName } : null;
        }
      : undefined,
  });
  if (resolution.source === "demo-api-key") {
    console.log(
      `Seeding under the demo API key's team "${resolution.team.displayName}" (${resolution.team.id})`,
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

console.log(
  `Prepared ${scenario.versions.length} releases, ${scenario.contracts.length} contracts, and ${scenario.events.length.toLocaleString()} request events.`,
);

const uploadedVersions = new Set(
  scenario.contracts.map((contract) => contract.version),
);
const missingContractVersions = scenario.versions
  .map((plan) => plan.version)
  .filter((version) => !uploadedVersions.has(version));

// Remove artifacts that an earlier seed may have uploaded for the versions
// intentionally kept traffic-only in the current preview story.
if (missingContractVersions.length > 0) {
  await db
    .delete(projectVersions)
    .where(
      and(
        eq(projectVersions.projectId, PROJECT_ID),
        inArray(projectVersions.version, missingContractVersions),
      ),
    );
}

// Re-seeding intentionally refreshes the generated artifacts. The scenario is
// deterministic, so an existing version receives the same contract unless the
// seed generator itself has evolved.
for (const contract of scenario.contracts) {
  await db
    .insert(projectVersions)
    .values({
      projectId: PROJECT_ID,
      version: contract.version,
      integrityHash: contract.integrityHash,
      snapshot: contract.snapshot,
      createdAt: contract.releasedAt,
    })
    .onConflictDoUpdate({
      target: [projectVersions.projectId, projectVersions.version],
      set: {
        integrityHash: contract.integrityHash,
        snapshot: contract.snapshot,
        createdAt: contract.releasedAt,
      },
    });
}

// The sunset schedule a real project uploads via `versionless snapshot`.
// Replaced wholesale so a re-seed after the shape changes leaves no orphans.
await db.delete(projectSunsets).where(eq(projectSunsets.projectId, PROJECT_ID));
if (scenario.sunsets.length > 0) {
  await db.insert(projectSunsets).values(
    scenario.sunsets.map((sunset) => ({
      projectId: PROJECT_ID,
      version: sunset.version,
      after: sunset.after,
      message: sunset.message,
    })),
  );
}

const events: TelemetryEvent[] = scenario.events;

let traceSeed = 7_337;
function rand(): number {
  traceSeed = (Math.imul(traceSeed, 1_664_525) + 1_013_904_223) >>> 0;
  return traceSeed / 2 ** 32;
}

// Sampled traces mirror the SDK's cloud trace capture: a subset of the last
// week's events also get a versionless span tree — exchange root, resolve, and
// one transform.down span per drift step — so the Traces insights view has
// data. The seed emits the same native OTLP span attributes as the SDK and lets
// the Collector own ClickHouse mapping.
//
// Current SDKs promote every failure after the final status is known while
// sampling successful traces. Aggregate counts still read the unsampled logs
// because tracing can be disabled or filtered.
const TRACE_SAMPLE = DEFAULT_TRACE_SAMPLE;
const traces: CapturedTrace[] = [];
let traceCounter = 0;
const traceRunPrefix = randomBytes(12).toString("hex");

for (const event of events) {
  const daysOld = (now - event.ts) / DAY;
  const failed = event.status >= 400;
  // Only past events within the last week: the traces list sorts by recency
  // and future-dated rows (day-0 events land anywhere in today) read wrong.
  if (
    daysOld < 0 ||
    daysOld > 7 ||
    (!failed && rand() >= TRACE_SAMPLE)
  ) {
    continue;
  }
  const traceId = `${traceRunPrefix}${(traceCounter++)
    .toString(16)
    .padStart(8, "0")}`;
  const traceSpans: CapturedSpan[] = [];
  // A captured trace of a failing request always records the failure — the
  // sampling decision is made once, at the root, and applies to the whole tree.
  // Request logs are emitted when finish() runs, while the root span begins at
  // exchange open. Keep that production timing relationship in the seed so
  // occurrence-detail correlation is exercised honestly.
  const traceDurationMs = event.latencyMs + rand();
  const traceStartedAt = event.ts - traceDurationMs;

  traceSpans.push({
    spanId: "0000000000000001",
    name: "versionless.exchange",
    startMs: traceStartedAt,
    durationMs: traceDurationMs,
    attrs: {
      "versionless.adapter": event.adapter,
      "versionless.method": event.method,
      "versionless.route": event.route,
      "versionless.version": event.version,
      "versionless.status": event.status,
      "versionless.transform_count": event.transformCount,
    },
    ...(failed ? { failed: true } : {}),
  });
  traceSpans.push({
    spanId: "0000000000000002",
    parentSpanId: "0000000000000001",
    name: "versionless.resolve",
    startMs: traceStartedAt,
    durationMs: 0.05 + rand() * 0.2,
    attrs: {
      "versionless.version.source": "header",
      "versionless.version": event.version,
    },
  });
  // One down-transform span per drift step, newest change first.
  const changes = scenario.versions
    .map((plan) => plan.version)
    .filter((version) => version > event.version)
    .reverse();
  let offset = 1 + rand() * 2;
  for (let step = 0; step < event.transformCount; step++) {
    const change = changes[step % Math.max(1, changes.length)] ?? "2026-07-21";
    const isLast = step === event.transformCount - 1;
    traceSpans.push({
      spanId: (step + 3).toString(16).padStart(16, "0"),
      parentSpanId: "0000000000000001",
      name: "versionless.transform.down",
      startMs: traceStartedAt + Math.round(offset),
      durationMs: 0.1 + rand() * 0.8,
      attrs: { "versionless.change": change, "versionless.route": event.route },
      ...(failed && isLast ? { failed: true } : {}),
    });
    offset += 0.5 + rand() * 1.5;
  }
  traces.push({ traceId, spans: traceSpans });
}

function trustedResource(attributes: OtlpKeyValue[]): OtlpKeyValue[] {
  if (USE_AUTHENTICATED_GATEWAY) return attributes;
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
  await postSeedBatch({
    url: `${OTLP_BASE_URL}/v1/${signal}`,
    body,
    headers: USE_AUTHENTICATED_GATEWAY
      ? {
          authorization: `Bearer ${DEMO_API_KEY}`,
          "x-versionless-project": PROJECT_NAME,
        }
      : undefined,
    onRetry: ({ attempt, maxAttempts, delayMs }) => {
      console.log(
        `Collector ${signal} queue is busy; retrying batch in ${delayMs}ms (attempt ${attempt}/${maxAttempts})…`,
      );
    },
  });
}

// The local Collector's ClickHouse exporter queue accepts fewer than 2,000
// records at once. Keep batches comfortably below that boundary and let the
// bounded retry above absorb normal exporter backpressure.
const LOG_BATCH = 500;
for (let offset = 0; offset < events.length; offset += LOG_BATCH) {
  const request = telemetryEventsToOtlp(
    PROJECT_NAME,
    events.slice(offset, offset + LOG_BATCH),
  );
  const resource = request.resourceLogs[0]!.resource!;
  resource.attributes = trustedResource(resource.attributes ?? []);
  await post("logs", request);
  if (offset > 0 && offset % 40_000 === 0) {
    console.log(
      `Seeded ${offset.toLocaleString()} / ${events.length.toLocaleString()} request logs…`,
    );
  }
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
  `Done — ${scenario.versions.length} versions, ${scenario.contracts.length} uploaded contracts, ${events.length + 1} logs, and ${traces.length + 1} traces (${spanCount} spans) written through the Collector. Open the dashboard: http://localhost:3001/dashboard/insights`,
);
