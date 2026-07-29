/**
 * Executes every dashboard query against a live ClickHouse and reports which
 * ones the server refuses to parse or plan.
 *
 * Unit tests assert on the SQL *string*, which is exactly why they missed
 * `sum(requests) AS requests` shadowing the column that a sibling
 * `sum(depth_sum) / sum(requests)` then referred to — the string was correct in
 * every way a regex could check, and ClickHouse still rejected it with
 * "Aggregate function sum(requests) AS requests is found inside another
 * aggregate function". Only the server can answer whether a query is valid.
 *
 * Empty results are a pass. This checks that each query parses, plans, and
 * returns the column names its presenter reads; it is not a data assertion, so
 * it is useful against an empty database and more useful against a seeded one.
 *
 *   bun run --cwd apps/dashboard validate-queries
 *
 * The package script supplies the app env the query modules pull in through
 * their import chain. None of it is used to reach ClickHouse — only
 * `CLICKHOUSE_URL` is — but those modules will not load without it.
 */
import {
  errorGroupHistoryQueryOptions,
  errorGroupOccurrencesQueryOptions,
  errorOccurrenceDetailQueryOptions,
  errorOverviewQueryOptions,
} from "../src/queries/errors";
import {
  adoptionQueryOptions,
  sunsetBlockersQueryOptions,
  transformDepthQueryOptions,
  versionAggregationQueryOptions,
  versionRouteAnalyticsQueryOptions,
} from "../src/queries/insights";
import {
  latencyOverviewQueryOptions,
  slowestRoutesQueryOptions,
} from "../src/queries/latency";
import {
  ingestFreshnessQueryOptions,
  outreachQueryOptions,
  routeVersionErrorsQueryOptions,
} from "../src/queries/overview";
import {
  rollupDailyQueryOptions,
  rollupTotalsQueryOptions,
  rollupVersionsQueryOptions,
} from "../src/queries/rollup";
import { telemetryQueryOptions } from "../src/queries/telemetry";
import {
  traceEventsQueryOptions,
  traceListQueryOptions,
  traceSpansQueryOptions,
} from "../src/queries/traces";

const projectId = "00000000-0000-4000-8000-000000000001";
const teamId = "demo";
const days = 30;

/**
 * `projectQueryOptions` folds the SQL and params into the React Query key at
 * fixed positions, so the key is also the most direct handle on what a query
 * would actually send. Reading it here keeps the runner honest: it executes the
 * same string the dashboard does, rather than a copy that can drift.
 */
function sqlOf(options: { queryKey: readonly unknown[] }): {
  query: string;
  params: Record<string, unknown>;
} {
  const [, , , query, params] = options.queryKey;
  if (typeof query !== "string") {
    throw new Error("query options did not carry SQL at the expected key slot");
  }
  return { query, params: (params ?? {}) as Record<string, unknown> };
}

const occurrence = { traceId: "0".repeat(32), ts: "2026-07-24 00:00:00", durationMs: 0 };
const trace = {
  traceId: "0".repeat(32),
  ts: "2026-07-24 00:00:00",
  route: "GET /users",
  version: "2026-07-21",
  status: 200,
  durationMs: 1,
  spanCount: 1,
  hasError: false,
};

const CASES: Array<{
  name: string;
  options: { queryKey: readonly unknown[] };
  params?: Record<string, unknown>;
  /** Columns the presenter reads off each row. */
  expects?: string[];
}> = [
  {
    name: "rollup-totals",
    options: rollupTotalsQueryOptions({ projectId, days }),
    expects: [
      "requests", "errors", "consumers", "p50", "p95", "p99",
      "avg_depth", "max_depth", "negotiated", "sourced", "unpinned", "clamped",
    ],
  },
  {
    name: "rollup-daily",
    options: rollupDailyQueryOptions({ projectId, days }),
    expects: ["day", "requests", "errors", "consumers", "p95", "avg_depth"],
  },
  {
    name: "rollup-versions",
    options: rollupVersionsQueryOptions({ projectId, days }),
    expects: [
      "version", "requests", "errors", "consumers", "p95", "avg_depth", "last_seen",
    ],
  },
  {
    name: "route-version-errors",
    options: routeVersionErrorsQueryOptions({ projectId, days }),
    expects: ["route", "version", "requests", "errors"],
  },
  {
    name: "outreach",
    options: outreachQueryOptions({ projectId, days }),
    expects: [
      "consumer_key", "version", "versions", "requests", "avg_depth", "last_seen",
    ],
  },
  {
    name: "ingest-freshness",
    options: ingestFreshnessQueryOptions({ projectId }),
  },
  {
    name: "latency-overview",
    options: latencyOverviewQueryOptions({ projectId, days }),
    expects: ["depth", "p50", "p95", "p99", "requests"],
  },
  {
    name: "slowest-routes",
    options: slowestRoutesQueryOptions({ projectId, days }),
    expects: ["route", "version", "avg_depth", "p50", "p95", "p99", "requests"],
  },
  {
    name: "error-overview",
    options: errorOverviewQueryOptions({ projectId, days }),
  },
  {
    name: "error-group-history",
    options: errorGroupHistoryQueryOptions({
      projectId, days, version: "2026-07-21", route: "GET /users", status: 500,
    }),
  },
  {
    name: "error-group-occurrences",
    options: errorGroupOccurrencesQueryOptions({
      projectId, days, version: "2026-07-21", route: "GET /users", status: 500,
    }),
    params: {
      hours: days * 24,
      version: "2026-07-21",
      route: "GET /users",
      status: 500,
      occurrenceLimit: 20,
      cursorStartedAt: "",
      cursorTraceId: "",
    },
  },
  {
    name: "error-occurrence-detail",
    options: errorOccurrenceDetailQueryOptions({
      projectId, occurrence, version: "2026-07-21", route: "GET /users", status: 500,
    }),
  },
  { name: "versions", options: versionAggregationQueryOptions(projectId, days) },
  { name: "adoption", options: adoptionQueryOptions(projectId, days) },
  {
    name: "sunset-blockers",
    options: sunsetBlockersQueryOptions({
      projectId, version: "2026-07-21", sort: "requests", direction: "desc",
    }),
  },
  {
    name: "transform-depth",
    options: transformDepthQueryOptions({
      projectId, days, sort: "avg", direction: "desc",
    }),
  },
  {
    name: "version-route-analytics",
    options: versionRouteAnalyticsQueryOptions({
      projectId, version: "2026-07-21", days,
    }),
  },
  {
    name: "telemetry",
    options: telemetryQueryOptions({ projectId, hours: 24, signal: "all", limit: 50 }),
  },
  {
    name: "trace-list",
    options: traceListQueryOptions({
      projectId, hours: 24, errorsOnly: false, sort: "time", direction: "desc",
    }),
  },
  { name: "trace-spans", options: traceSpansQueryOptions(projectId, trace) },
  { name: "trace-events", options: traceEventsQueryOptions(projectId, trace) },
];

// Standalone dev/CI tooling reads its one operator-supplied variable directly:
// pulling in @versionless/env/server would demand the whole server schema
// (DATABASE_URL, Hexclave keys) this script has no use for.
const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error(
    "Set CLICKHOUSE_URL, e.g.\n" +
      "  CLICKHOUSE_URL=http://clickhouse:password@localhost:18123/versionless \\\n" +
      "    bun run --cwd apps/dashboard validate-queries",
  );
  process.exit(2);
}

const parsed = new URL(url);
const endpoint = `${parsed.protocol}//${parsed.host}`;
const database = parsed.pathname.replace(/^\//, "") || "default";
const auth = `Basic ${btoa(
  `${decodeURIComponent(parsed.username) || "default"}:${decodeURIComponent(parsed.password)}`,
)}`;

/**
 * ClickHouse's HTTP interface binds `{name: Type}` placeholders from `param_*`
 * query-string entries, which is the same substitution the official client
 * performs — so this runs the dashboard's parameterized SQL verbatim without
 * `apps/dashboard` taking on a ClickHouse client dependency it otherwise has no use
 * for.
 */
async function run(
  query: string,
  params: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const search = new URLSearchParams({
    database,
    default_format: "JSONEachRow",
    // The row policies key off these, exactly as the server sets them.
    SQL_project_id: projectId,
    SQL_team_id: teamId,
    max_execution_time: "30",
  });
  for (const [key, value] of Object.entries(params)) {
    search.set(`param_${key}`, String(value));
  }

  const response = await fetch(`${endpoint}/?${search}`, {
    method: "POST",
    headers: { authorization: auth },
    body: query,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text.trim());
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

let failed = 0;
for (const testCase of CASES) {
  const { query, params: optionParams } = sqlOf(testCase.options);
  const params = testCase.params ?? optionParams;
  try {
    const rows = await run(query, params);

    // A query can parse and still return the wrong column names — an alias
    // typo reaches the presenter as `undefined`, not as an error. Only
    // checkable when the window actually held rows.
    const missing =
      rows[0] === undefined
        ? []
        : (testCase.expects ?? []).filter((column) => !(column in rows[0]!));
    if (missing.length > 0) {
      failed += 1;
      console.error(`✗ ${testCase.name}: missing column(s) ${missing.join(", ")}`);
      continue;
    }

    const shape = rows.length === 0 ? "0 rows" : `${rows.length} rows`;
    console.log(`✓ ${testCase.name} (${shape})`);
  } catch (error) {
    failed += 1;
    console.error(
      `✗ ${testCase.name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
  }
}

console.log(
  failed === 0
    ? `\nAll ${CASES.length} queries executed.`
    : `\n${failed} of ${CASES.length} queries failed.`,
);
process.exit(failed === 0 ? 0 : 1);
