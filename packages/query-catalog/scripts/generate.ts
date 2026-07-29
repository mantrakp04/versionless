import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  errorGroupHistoryQueryOptions,
  errorGroupOccurrencesQueryOptions,
  errorOccurrenceDetailQueryOptions,
  errorOverviewQueryOptions,
} from "../../../apps/dashboard/src/queries/errors";
import {
  adoptionQueryOptions,
  sunsetBlockersQueryOptions,
  transformDepthQueryOptions,
  versionAggregationQueryOptions,
  versionRouteAnalyticsQueryOptions,
} from "../../../apps/dashboard/src/queries/insights";
import {
  latencyOverviewQueryOptions,
  slowestRoutesQueryOptions,
} from "../../../apps/dashboard/src/queries/latency";
import {
  ingestFreshnessQueryOptions,
  outreachQueryOptions,
  routeVersionErrorsQueryOptions,
} from "../../../apps/dashboard/src/queries/overview";
import {
  rollupDailyQueryOptions,
  rollupTotalsQueryOptions,
  rollupVersionsQueryOptions,
  trafficCurveQueryOptions,
} from "../../../apps/dashboard/src/queries/rollup";
import { telemetryQueryOptions } from "../../../apps/dashboard/src/queries/telemetry";
import {
  traceEventsQueryOptions,
  traceListQueryOptions,
  traceSpansQueryOptions,
  type TraceSummary,
} from "../../../apps/dashboard/src/queries/traces";

type QueryOptions = { queryKey: readonly unknown[] };
type Candidate = {
  name: string;
  description: string;
  options: QueryOptions;
};

const projectId = "00000000-0000-4000-8000-000000000001";
const trace: TraceSummary = {
  traceId: "trace-id",
  ts: "2026-01-01 00:00:00.000",
  route: "GET /users",
  version: "2026-01-01",
  status: 500,
  durationMs: 100,
  spanCount: 4,
  hasError: true,
};
const occurrence = { traceId: trace.traceId, ts: trace.ts, durationMs: 100 };

const candidates: Candidate[] = [
  {
    name: "versions",
    description: "Request and consumer totals grouped by served API version.",
    options: versionAggregationQueryOptions(projectId, 30),
  },
  {
    name: "adoption-daily",
    description: "Daily API version adoption and unique consumers.",
    options: adoptionQueryOptions(projectId, 30),
  },
  {
    name: "adoption-hourly",
    description: "Hourly API version adoption over the last 24 hours.",
    options: adoptionQueryOptions(projectId, 1),
  },
  {
    name: "sunset-blockers",
    description: "Consumers and routes still using a retiring API version.",
    options: sunsetBlockersQueryOptions({
      projectId,
      version: "2026-01-01",
      sort: "requests",
      direction: "desc",
    }),
  },
  {
    name: "transform-depth",
    description: "Average, p95, and maximum transform depth by route.",
    options: transformDepthQueryOptions({
      projectId,
      days: 30,
      sort: "avg",
      direction: "desc",
    }),
  },
  {
    name: "version-route-analytics",
    description: "Route usage, consumers, and transform depth for one API version.",
    options: versionRouteAnalyticsQueryOptions({
      projectId,
      version: "2026-01-01",
      days: 30,
    }),
  },
  {
    name: "telemetry-all",
    description: "Recent log and span telemetry records in one ordered stream.",
    options: telemetryQueryOptions({
      projectId,
      hours: 24,
      signal: "all",
      limit: 100,
    }),
  },
  {
    name: "telemetry-logs",
    description: "Recent OpenTelemetry log records.",
    options: telemetryQueryOptions({
      projectId,
      hours: 24,
      signal: "log",
      limit: 100,
    }),
  },
  {
    name: "telemetry-spans",
    description: "Recent OpenTelemetry span records.",
    options: telemetryQueryOptions({
      projectId,
      hours: 24,
      signal: "span",
      limit: 100,
    }),
  },
  {
    name: "trace-list",
    description: "Recent root traces with route, version, status, latency, and span counts.",
    options: traceListQueryOptions({
      projectId,
      hours: 24,
      errorsOnly: false,
      sort: "time",
      direction: "desc",
    }),
  },
  {
    name: "trace-list-errors",
    description: "Recent traces containing error spans.",
    options: traceListQueryOptions({
      projectId,
      hours: 24,
      errorsOnly: true,
      sort: "time",
      direction: "desc",
    }),
  },
  {
    name: "trace-list-version",
    description: "Recent traces filtered to one served API version.",
    options: traceListQueryOptions({
      projectId,
      hours: 24,
      errorsOnly: false,
      version: "2026-01-01",
      sort: "time",
      direction: "desc",
    }),
  },
  {
    name: "trace-spans",
    description: "Bounded span detail for one trace.",
    options: traceSpansQueryOptions(projectId, trace),
  },
  {
    name: "trace-events",
    description: "Request log events correlated to one trace.",
    options: traceEventsQueryOptions(projectId, trace),
  },
  {
    name: "error-overview",
    description: "Error curve, recent signatures, and total error rate.",
    options: errorOverviewQueryOptions({ projectId, days: 7, limit: 6 }),
  },
  {
    name: "error-group-history-daily",
    description: "Daily request and error counts for one version and route.",
    options: errorGroupHistoryQueryOptions({
      projectId,
      days: 7,
      version: trace.version,
      route: trace.route,
      status: trace.status,
    }),
  },
  {
    name: "error-group-history-hourly",
    description: "Hourly request and error counts for one version and route.",
    options: errorGroupHistoryQueryOptions({
      projectId,
      days: 1,
      version: trace.version,
      route: trace.route,
      status: trace.status,
    }),
  },
  {
    name: "error-group-occurrences",
    description: "Cursor-paged trace occurrences for one error signature.",
    options: errorGroupOccurrencesQueryOptions({
      projectId,
      days: 7,
      version: trace.version,
      route: trace.route,
      status: trace.status,
    }),
  },
  {
    name: "error-occurrence-detail",
    description: "Span and request-log detail for one error occurrence.",
    options: errorOccurrenceDetailQueryOptions({
      projectId,
      occurrence,
      version: trace.version,
      route: trace.route,
      status: trace.status,
    }),
  },
  {
    name: "rollup-totals",
    description: "Headline request, error, consumer, latency, depth, and pinning totals.",
    options: rollupTotalsQueryOptions({ projectId, days: 30 }),
  },
  {
    name: "rollup-daily",
    description: "Daily request, error, consumer, latency, and depth trend.",
    options: rollupDailyQueryOptions({ projectId, days: 30 }),
  },
  {
    name: "traffic-curve-hourly",
    description: "Hourly traffic, errors, consumers, latency, and depth for 24 hours.",
    options: trafficCurveQueryOptions({ projectId, days: 1 }),
  },
  {
    name: "rollup-versions",
    description: "Top API versions by traffic with errors, consumers, latency, and depth.",
    options: rollupVersionsQueryOptions({ projectId, days: 30 }),
  },
  {
    name: "route-version-errors",
    description: "Request and error counts grouped by route and API version.",
    options: routeVersionErrorsQueryOptions({ projectId, days: 30 }),
  },
  {
    name: "outreach-consumers",
    description: "Consumer outreach list with current version, traffic, depth, and last seen.",
    options: outreachQueryOptions({ projectId, days: 30 }),
  },
  {
    name: "ingest-freshness",
    description: "Latest telemetry event and current versus prior-hour request counts.",
    options: ingestFreshnessQueryOptions({ projectId }),
  },
  {
    name: "latency-overview",
    description: "Overall and per-transform-depth latency quantiles.",
    options: latencyOverviewQueryOptions({ projectId, days: 30 }),
  },
  {
    name: "slowest-routes",
    description: "Slowest route and version pairs ranked by p95 latency.",
    options: slowestRoutesQueryOptions({ projectId, days: 30 }),
  },
];

function queryFrom(options: QueryOptions): string {
  const query = options.queryKey.find(
    (value) =>
      typeof value === "string" &&
      /(?:^|\n)\s*(?:SELECT|WITH)\b/i.test(value),
  );
  if (typeof query !== "string") {
    throw new Error(`Could not extract SQL from ${JSON.stringify(options.queryKey)}`);
  }
  return query.trim();
}

const definitions = candidates
  .map(({ name, description, options }) => ({
    name,
    description,
    query: queryFrom(options),
  }))
  .toSorted((left, right) => left.name.localeCompare(right.name));

const target = resolve(import.meta.dir, "../src/queries.generated.ts");
mkdirSync(dirname(target), { recursive: true });
await Bun.write(
  target,
  `// Generated by \`bun run generate\`. Do not edit by hand.\n` +
    `import type { QueryDefinition } from "./index";\n\n` +
    `export const QUERY_DEFINITIONS = ${JSON.stringify(definitions, null, 2)} as const satisfies readonly QueryDefinition[];\n`,
);
console.log(`generated ${definitions.length} queries in ${target}`);
