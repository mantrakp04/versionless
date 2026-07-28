import {
  fingerprintConsumerKey,
  safeTelemetryErrorBodyForStatus,
  stableStringify,
  type TelemetryEvent,
} from "@versionless/core";

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_VERSION_COUNT = 55;
const TRAFFIC_DAYS = 30;
const FIRST_RELEASE = { year: 2022, month: 0 };

const RESOURCE_NAMES = [
  "accounts",
  "api-keys",
  "audit-events",
  "balances",
  "catalog-items",
  "checkout-sessions",
  "customers",
  "disputes",
  "entitlements",
  "invoices",
  "members",
  "organizations",
  "orders",
  "payment-methods",
  "payments",
  "prices",
  "products",
  "refunds",
  "reports",
  "sessions",
  "shipments",
  "subscriptions",
  "usage-records",
  "webhook-endpoints",
] as const;

const HTTP_OPERATIONS = [
  { method: "GET", suffix: "", requestFields: 3 },
  { method: "POST", suffix: "", requestFields: 5 },
  { method: "GET", suffix: "/:id", requestFields: 1 },
  { method: "PATCH", suffix: "/:id", requestFields: 4 },
  { method: "DELETE", suffix: "/:id", requestFields: 1 },
  { method: "POST", suffix: "/:id/archive", requestFields: 2 },
  { method: "GET", suffix: "/:id/events", requestFields: 3 },
  { method: "POST", suffix: "/search", requestFields: 4 },
  { method: "GET", suffix: "/:id/relationships", requestFields: 2 },
] as const;

const MODEL_NAMES = [
  "Account",
  "ApiKey",
  "AuditEvent",
  "Balance",
  "CatalogItem",
  "CheckoutSession",
  "Customer",
  "Dispute",
  "Entitlement",
  "Invoice",
  "Member",
  "Organization",
  "Order",
  "PaymentMethod",
  "Payment",
  "Price",
  "Product",
  "Refund",
  "Report",
  "Session",
  "Shipment",
  "Subscription",
  "UsageRecord",
  "WebhookEndpoint",
  "Address",
  "Adjustment",
  "CurrencyAmount",
  "Error",
  "Event",
  "LineItem",
  "Metadata",
  "Pagination",
  "TaxRate",
  "TimelineEntry",
  "Version",
  "Workspace",
] as const;

interface SeedEndpoint {
  id: string;
  method: string;
  route: string;
  adapter: string;
  definition: Record<string, unknown>;
}

export interface SeedVersionPlan {
  version: string;
  releasedAt: Date;
  requestTarget: number;
  clientCount: number;
  endpointCount: number;
  modelCount: number;
  popularity: "launch" | "stable" | "lts" | "long-tail";
}

export interface SeedContract {
  version: string;
  releasedAt: Date;
  integrityHash: string;
  snapshot: Record<string, unknown>;
  routes: SeedEndpoint[];
}

export interface SeedSunset {
  /** Sunsets every version <= this one. */
  version: string;
  /** Last day the cohort is served, `YYYY-MM-DD` UTC. */
  after: string;
  message: string | null;
}

export interface SeedScenario {
  versions: SeedVersionPlan[];
  contracts: SeedContract[];
  sunsets: SeedSunset[];
  events: TelemetryEvent[];
}

export interface SeedErrorProfile {
  version: string;
  route: string;
  status: number;
  occurrenceTarget: number;
  latencyMs: { min: number; max: number; spike: number };
}

/**
 * Heavy-tail failures keep the preview honest at production-like cardinality:
 * a few signatures dominate while the normal random error mix remains broad.
 */
export const SEED_ERROR_PROFILES: readonly SeedErrorProfile[] = [
  {
    version: "2026-07-21",
    route: "GET /v1/api-keys",
    status: 400,
    occurrenceTarget: 1_400,
    latencyMs: { min: 18, max: 180, spike: 1_800 },
  },
  {
    version: "2025-08-01",
    route: "GET /v1/audit-events/:id",
    status: 500,
    occurrenceTarget: 1_200,
    latencyMs: { min: 120, max: 950, spike: 4_800 },
  },
  {
    version: "2024-11-01",
    route: "GET /v1/balances/:id",
    status: 404,
    occurrenceTarget: 1_050,
    latencyMs: { min: 24, max: 420, spike: 2_400 },
  },
  {
    version: "2023-08-01",
    route: "GET /v1/audit-events/:id",
    status: 409,
    occurrenceTarget: 360,
    latencyMs: { min: 35, max: 680, spike: 3_100 },
  },
] as const;

export function seedErrorProfileFor(
  event: Pick<TelemetryEvent, "version" | "route" | "status">,
): SeedErrorProfile | undefined {
  return SEED_ERROR_PROFILES.find(
    (profile) =>
      profile.version === event.version &&
      profile.route === event.route &&
      profile.status === event.status,
  );
}

function createRandom(initialSeed: number): () => number {
  let state = initialSeed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function releaseDate(index: number): Date {
  const monthStart = new Date(
    Date.UTC(FIRST_RELEASE.year, FIRST_RELEASE.month + index, 1),
  );
  const month = `${monthStart.getUTCFullYear()}-${String(
    monthStart.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
  const canonicalDays: Record<string, number> = {
    "2025-01": 1,
    "2025-06": 1,
    "2026-05": 14,
    "2026-07": 21,
  };
  return new Date(
    Date.UTC(
      monthStart.getUTCFullYear(),
      monthStart.getUTCMonth(),
      canonicalDays[month] ?? (index % 6 === 0 ? 14 : 1),
    ),
  );
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function objectSchema(fieldCount: number): Record<string, unknown> {
  return {
    kind: "object",
    open: true,
    fields: Object.fromEntries(
      Array.from({ length: fieldCount }, (_, index) => [
        index === 0 ? "id" : `field${index + 1}`,
        {
          type:
            index % 4 === 0
              ? { kind: "number" }
              : index % 5 === 0
                ? { kind: "boolean" }
                : { kind: "string" },
        },
      ]),
    ),
  };
}

function buildEndpointCatalog(): SeedEndpoint[] {
  const endpoints: SeedEndpoint[] = [];
  for (const [resourceIndex, resource] of RESOURCE_NAMES.entries()) {
    for (const [operationIndex, operation] of HTTP_OPERATIONS.entries()) {
      const path = `/v1/${resource}${operation.suffix}`;
      const responseModel =
        MODEL_NAMES[resourceIndex % MODEL_NAMES.length] ?? "Event";
      endpoints.push({
        id: `${operation.method} ${path}`,
        method: operation.method,
        route: `${operation.method} ${path}`,
        adapter: "elysia",
        definition: {
          transport: "http",
          method: operation.method,
          path,
          params: operation.suffix.includes(":id") ? objectSchema(1) : null,
          query:
            operation.method === "GET" && !operation.suffix.includes(":id")
              ? objectSchema(operation.requestFields)
              : null,
          body:
            operation.method === "POST" || operation.method === "PATCH"
              ? objectSchema(operation.requestFields)
              : null,
          responses: {
            "200":
              operationIndex === 0
                ? {
                    kind: "array",
                    items: { kind: "ref", name: responseModel },
                  }
                : { kind: "ref", name: responseModel },
            ...(operationIndex % 3 === 0
              ? { "400": { kind: "ref", name: "Error" } }
              : {}),
            ...(operationIndex % 5 === 0
              ? { "409": { kind: "ref", name: "Error" } }
              : {}),
          },
        },
      });
    }
  }

  for (let index = 0; index < 18; index++) {
    const resource = RESOURCE_NAMES[index % RESOURCE_NAMES.length]!;
    const procedure = `sdk.${resource.replaceAll("-", "_")}.${index % 2 === 0 ? "list" : "sync"}`;
    endpoints.push({
      id: `trpc:${procedure}`,
      method: "QUERY",
      route: `trpc:${procedure}`,
      adapter: "trpc",
      definition: {
        transport: "trpc",
        mount: "/rpc",
        procedure,
        procedureType: index % 3 === 0 ? "mutation" : "query",
        input: objectSchema(2 + (index % 4)),
        output: {
          kind: "array",
          items: { kind: "ref", name: "Event" },
        },
      },
    });
  }
  return endpoints;
}

function popularityForAge(age: number): SeedVersionPlan["popularity"] {
  if (age === 0) return "launch";
  if (age === 1 || age === 4) return "stable";
  if (age === 11 || age === 23 || age === 35) return "lts";
  return "long-tail";
}

function requestTargetFor(
  index: number,
  age: number,
  popularity: SeedVersionPlan["popularity"],
): number {
  const baseline = 2_050 + ((index * 487) % 900);
  if (popularity === "launch") return 22_000;
  if (popularity === "stable") return age === 1 ? 15_000 : 11_500;
  if (popularity === "lts") {
    return age === 11 ? 9_000 : age === 23 ? 7_500 : 6_000;
  }
  return baseline;
}

export function createSeedVersionPlans(
  versionCount = DEFAULT_VERSION_COUNT,
): SeedVersionPlan[] {
  if (versionCount < 1) return [];
  return Array.from({ length: versionCount }, (_, index) => {
    const age = versionCount - index - 1;
    const popularity = popularityForAge(age);
    const requestTarget = requestTargetFor(index, age, popularity);
    return {
      version: isoDate(releaseDate(index)),
      releasedAt: releaseDate(index),
      requestTarget,
      clientCount: Math.max(
        5,
        Math.round(
          Math.sqrt(requestTarget) * (popularity === "long-tail" ? 0.3 : 0.48),
        ),
      ),
      endpointCount:
        104 + Math.round((60 * index) / Math.max(1, versionCount - 1)),
      modelCount: 18 + Math.round((18 * index) / Math.max(1, versionCount - 1)),
      popularity,
    };
  });
}

function buildModels(count: number): Record<string, unknown> {
  return Object.fromEntries(
    MODEL_NAMES.slice(0, count).map((name, index) => [
      name,
      {
        kind: "object",
        fields: {
          ...objectSchema(4 + (index % 6)).fields,
          createdAt: { type: { kind: "string", format: "date-time" } },
          metadata: { type: { kind: "ref", name: "Metadata" } },
        },
      },
    ]),
  );
}

export function createSeedContracts(
  versions: SeedVersionPlan[],
): SeedContract[] {
  const catalog = buildEndpointCatalog();
  return versions.map((plan, versionIndex) => {
    // A small rolling window of low-use endpoints disappears as the surface
    // grows, avoiding an unrealistically append-only history.
    const retirementOffset = Math.floor(versionIndex / 12) * 2;
    const routes = catalog.slice(
      retirementOffset,
      retirementOffset + plan.endpointCount,
    );
    const content = {
      endpoints: Object.fromEntries(
        routes.map((endpoint) => [endpoint.id, endpoint.definition]),
      ),
      formatVersion: 1,
      models: buildModels(plan.modelCount),
      provenance: {
        repo: "versionless/seed-commerce-platform",
        ref: `refs/tags/${plan.version}`,
        sha: fnv1a(`sha:${plan.version}`).repeat(5),
      },
      tool: "@versionless/seed@1.0.0",
      version: plan.version,
    };
    const integrityHash = fnv1a(stableStringify(content));
    return {
      version: plan.version,
      releasedAt: plan.releasedAt,
      integrityHash,
      snapshot: {
        ...content,
        integrity: { algo: "fnv1a-32", hash: integrityHash },
      },
      routes,
    };
  });
}

/**
 * A retirement schedule shaped like a real one: one cohort already past its
 * date (the dashboard must show it as overdue, not merely scheduled), one
 * closing inside the quarter, and one far enough out to be uncontroversial.
 * Anchored to `now` so the preview never drifts into "every sunset is ancient
 * history" as the fixed dates age.
 */
export function createSeedSunsets(
  versions: SeedVersionPlan[],
  now: number,
): SeedSunset[] {
  if (versions.length < 4) return [];
  const day = (offset: number) => isoDate(new Date(now + offset * DAY));
  const at = (fraction: number) =>
    versions[Math.min(versions.length - 1, Math.floor(versions.length * fraction))]!
      .version;
  return [
    {
      version: at(0),
      after: day(-45),
      message:
        "Versions from the original launch cohort were retired. Upgrade to a supported version.",
    },
    {
      version: at(0.35),
      after: day(58),
      message: "Legacy cohort retires this quarter — see the migration guide.",
    },
    { version: at(0.6), after: day(420), message: null },
  ];
}

export function shouldUploadSeedContract(
  versionIndex: number,
  versionCount: number,
): boolean {
  if (versionIndex <= 0 || versionIndex >= versionCount - 1) return true;
  return versionIndex % 13 !== 9;
}

/**
 * Which failure a request produces, once it has been decided that it fails.
 * Conditional on failure, so the overall error rate is set independently by
 * the per-signature Beta draw below.
 */
function failureStatusFrom(random: number): number {
  if (random < 0.34) return 400;
  if (random < 0.6) return 404;
  if (random < 0.77) return 409;
  if (random < 0.94) return 429;
  return 500;
}

/**
 * Per-signature error probability, drawn from a Beta distribution.
 *
 * A single global error rate produces binomial noise: every route sits within
 * a percent or so of the mean, which is not what real APIs look like. Measured
 * per-endpoint failure rates are strongly overdispersed — most endpoints are
 * near-perfect while a handful fail persistently — which is the Beta-Binomial
 * shape. Drawing p ~ Beta(alpha, beta) per (version, route) and then flipping
 * a per-request coin against it reproduces that spread: a long left mass near
 * zero plus a thin tail of genuinely unhealthy signatures.
 *
 * alpha < 1 puts most of the mass near zero; the mean is alpha / (alpha+beta),
 * here ≈ 0.9%, close to the previous flat 4.8% but distributed realistically.
 */
const ERROR_BETA_ALPHA = 0.45;
const ERROR_BETA_BETA = 50;

/**
 * Gamma(shape < 1) via Johnk's method, which needs no normal deviates and
 * stays exact for the small shapes used here. Beta(a,b) = X/(X+Y) for
 * independent X ~ Gamma(a), Y ~ Gamma(b).
 */
function gammaSmallShape(shape: number, random: () => number): number {
  // Ahrens-Dieter (1974) GS algorithm for 0 < shape < 1.
  const boundary = (Math.E + shape) / Math.E;
  for (let attempt = 0; attempt < 64; attempt++) {
    const p = boundary * random();
    if (p <= 1) {
      const x = p ** (1 / shape);
      if (-Math.log(Math.max(random(), Number.MIN_VALUE)) >= x) return x;
    } else {
      const x = -Math.log(Math.max((boundary - p) / shape, Number.MIN_VALUE));
      if (random() <= x ** (shape - 1)) return x;
    }
  }
  return shape;
}

/** Gamma(shape >= 1) via Marsaglia-Tsang, using a Box-Muller normal. */
function gammaLargeShape(shape: number, random: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 64; attempt++) {
    const u1 = Math.max(random(), Number.MIN_VALUE);
    const u2 = random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const v = (1 + c * normal) ** 3;
    if (v <= 0) continue;
    const u = Math.max(random(), Number.MIN_VALUE);
    if (Math.log(u) < 0.5 * normal ** 2 + d - d * v + d * Math.log(v)) {
      return d * v;
    }
  }
  return d;
}

function gammaSample(shape: number, random: () => number): number {
  return shape < 1
    ? gammaSmallShape(shape, random)
    : gammaLargeShape(shape, random);
}

function betaSample(
  alpha: number,
  beta: number,
  random: () => number,
): number {
  const x = gammaSample(alpha, random);
  const y = gammaSample(beta, random);
  return x + y === 0 ? 0 : x / (x + y);
}

/**
 * Deterministic per-signature error probability. Seeded from the signature
 * itself so the same route keeps the same health across a reseed — real
 * endpoints don't reshuffle their reliability every day.
 */
export function seedErrorProbability(version: string, route: string): number {
  const seed = Number.parseInt(fnv1a(`error-rate:${version}:${route}`), 16);
  return betaSample(ERROR_BETA_ALPHA, ERROR_BETA_BETA, createRandom(seed));
}

/**
 * Where a consumer's version pin comes from, drawn deterministically from its
 * key so a given client keeps the same integration style across a reseed.
 *
 * Pinning is a property of an integration, not of a request: a client that
 * hardcodes `x-api-version` does so on every call, and one that never sets it
 * never does. Rolling per-request would smear every consumer to the population
 * mean and erase exactly the split section 06 exists to show.
 *
 * The mix — most on an explicit header, a meaningful minority unpinned, a few
 * bound to their API key — matches how SDK-generated and hand-rolled clients
 * divide in practice.
 */
export function seedVersionSource(
  consumerKey: string,
): "header" | "query" | "apiKey" | "default" {
  const roll =
    Number.parseInt(fnv1a(`version-source:${consumerKey}`), 16) / 2 ** 32;
  if (roll < 0.58) return "header";
  if (roll < 0.82) return "default";
  if (roll < 0.95) return "apiKey";
  return "query";
}

/**
 * A tiny slice of traffic pins a version *newer* than the server declares and
 * gets clamped back — an SDK that shipped ahead of the API, or a rolled-back
 * deploy. Rare, and never benign, which is why the overview surfaces any of it
 * at all rather than waiting for a threshold.
 */
const SEED_CLAMPED_SHARE = 0.004;

export function createSeedEvents(
  versions: SeedVersionPlan[],
  contracts: SeedContract[],
  now: number,
  initialSeed = 42,
): TelemetryEvent[] {
  const random = createRandom(initialSeed);
  const contractsByVersion = new Map(
    contracts.map((contract) => [contract.version, contract]),
  );
  const events: TelemetryEvent[] = [];
  // One Beta draw per signature, reused across that signature's requests —
  // that is what makes the result Beta-Binomial rather than plain binomial.
  const errorProbabilities = new Map<string, number>();
  const errorProbabilityFor = (version: string, route: string): number => {
    const key = `${version} ${route}`;
    let probability = errorProbabilities.get(key);
    if (probability === undefined) {
      probability = seedErrorProbability(version, route);
      errorProbabilities.set(key, probability);
    }
    return probability;
  };

  for (const [versionIndex, plan] of versions.entries()) {
    const contract = contractsByVersion.get(plan.version);
    if (!contract) continue;
    const age = versions.length - versionIndex - 1;
    const recencyBias =
      plan.popularity === "launch"
        ? 2.6
        : plan.popularity === "stable"
          ? 1.55
          : plan.popularity === "lts"
            ? 1.2
            : 0.92;

    for (let index = 0; index < plan.requestTarget; index++) {
      const errorProfile = SEED_ERROR_PROFILES.find(
        (profile) => profile.version === plan.version,
      );
      const isProfileOccurrence =
        errorProfile !== undefined && index < errorProfile.occurrenceTarget;
      // Squaring the random route index produces the familiar API shape where
      // list/create/get dominate and the long tail remains visible.
      const randomRouteIndex = Math.min(
        contract.routes.length - 1,
        Math.floor(random() ** 2.15 * contract.routes.length),
      );
      const profileRouteIndex = errorProfile
        ? contract.routes.findIndex(
            (endpoint) => endpoint.id === errorProfile.route,
          )
        : -1;
      const routeIndex =
        isProfileOccurrence && profileRouteIndex >= 0
          ? profileRouteIndex
          : randomRouteIndex;
      const route = contract.routes[routeIndex]!;
      const consumerIndex = Math.min(
        plan.clientCount - 1,
        Math.floor(random() ** 1.8 * plan.clientCount),
      );
      const daysAgo = Math.min(
        TRAFFIC_DAYS - 1,
        Math.floor(random() ** recencyBias * TRAFFIC_DAYS),
      );
      const hour = Math.floor(random() * 24);
      const businessHourBoost = hour >= 7 && hour <= 20 ? 1 : 0.45;
      const intraDayOffset =
        (hour * 60 * 60 + Math.floor(random() * 60 * 60)) * 1000;
      const transformCount = Math.min(
        8,
        Math.floor(age / 7) + (routeIndex % 17 === 0 ? 1 : 0),
      );
      // Deeper transform chains fail somewhat more often: each hop is another
      // place a payload can fail to satisfy the next version's shape. Keeping
      // that correlation in the seed is what gives the version-vs-reliability
      // comparison something real to find.
      const failureProbability = Math.min(
        0.6,
        errorProbabilityFor(plan.version, route.id) * (1 + 0.35 * transformCount),
      );
      const fails = random() < failureProbability;
      const failureStatus = failureStatusFrom(random());
      const randomStatus = fails ? failureStatus : 200;
      const status = isProfileOccurrence
        ? errorProfile.status
        : errorProfile &&
            route.id === errorProfile.route &&
            randomStatus === errorProfile.status
          ? 200
          : randomStatus;
      const latencyMs = isProfileOccurrence
        ? index % 97 === 0
          ? errorProfile.latencyMs.spike + Math.round(random() * 250)
          : Math.round(
              errorProfile.latencyMs.min +
                random() ** 2.2 *
                  (errorProfile.latencyMs.max - errorProfile.latencyMs.min),
            )
        : Math.round(
            8 +
              random() * 85 +
              transformCount * 4 +
              (1 - businessHourBoost) * 12 +
              (status >= 500 ? 180 : 0),
          );

      // Fingerprinted exactly as the SDK does, so seeded consumer keys have
      // the same opaque shape and cardinality behaviour as real ones.
      const consumerKey = fingerprintConsumerKey(
        `sdk_${plan.version.replaceAll("-", "")}_${String(consumerIndex + 1).padStart(3, "0")}`,
      );
      // Clamping is a deploy-skew accident, so it is per-request rather than a
      // property of the consumer the way its pinning style is.
      const clamped = random() < SEED_CLAMPED_SHARE;
      const versionSource = clamped ? "header" : seedVersionSource(consumerKey);

      events.push({
        ts: now - daysAgo * DAY - intraDayOffset,
        method: route.method,
        route: route.route,
        adapter: route.adapter,
        version: plan.version,
        consumerKey,
        versionSource,
        // The exchange records `requestedVersion` only when it differs from the
        // version actually served, which for a clamped request is the newer one
        // the client asked for.
        ...(clamped
          ? { clamped: true, requestedVersion: "2099-01-01" }
          : {}),
        latencyMs,
        transformCount,
        status,
        ...(status >= 400
          ? { errorBody: safeTelemetryErrorBodyForStatus(status) }
          : {}),
      });
    }
  }
  return events;
}

export function createSeedScenario(options?: {
  now?: number;
  seed?: number;
  versionCount?: number;
}): SeedScenario {
  const now = options?.now ?? Date.now();
  const versions = createSeedVersionPlans(options?.versionCount);
  const allContracts = createSeedContracts(versions);
  return {
    versions,
    contracts: allContracts.filter((_, versionIndex) =>
      shouldUploadSeedContract(versionIndex, versions.length),
    ),
    sunsets: createSeedSunsets(versions, now),
    events: createSeedEvents(versions, allContracts, now, options?.seed),
  };
}
