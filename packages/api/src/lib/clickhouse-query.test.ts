import { describe, expect, test } from "bun:test";
import {
  executeProjectQuery,
  MAX_RESULT_BYTES,
  MAX_RESULT_ROWS,
  provisionQueryAccess,
  QUERY_USER,
  queryAccessStatements,
  resolveClickHouseDatabase,
  ROLLUP_TABLE,
  type RestrictedQueryClient,
} from "./clickhouse-query";

describe("tenant-isolated ClickHouse queries", () => {
  test("uses the configured Collector database when the public URL has no path", () => {
    expect(
      resolveClickHouseDatabase(
        "https://clickhouse.example.com",
        "versionless",
      ),
    ).toBe("versionless");
    expect(
      resolveClickHouseDatabase(
        "https://clickhouse.example.com/legacy",
        "versionless",
      ),
    ).toBe("versionless");
  });

  test("falls back to the URL database for local development", () => {
    expect(
      resolveClickHouseDatabase(
        "http://clickhouse:password@localhost:8123/versionless",
      ),
    ).toBe("versionless");
    expect(resolveClickHouseDatabase("http://localhost:8123")).toBe("default");
  });

  test("provisions both OTLP tables with project and team row policies", () => {
    const sql = queryAccessStatements("versionless").join("\n");

    expect(sql).toContain("ON `versionless`.otel_logs");
    expect(sql).toContain("ON `versionless`.otel_traces");
    expect(sql).toContain("getSetting('SQL_project_id')");
    expect(sql).toContain("getSetting('SQL_team_id')");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON *.*");
    expect(sql).toContain("GRANT SELECT ON `versionless`.otel_logs");
    expect(sql).not.toContain("GRANT SELECT ON *.*");
  });

  test("isolates the rollup on its own tenancy columns", () => {
    const statements = queryAccessStatements("versionless");
    const policies = statements.filter((statement) =>
      statement.includes(`ROW POLICY`),
    );
    const rollupPolicies = policies.filter((statement) =>
      statement.includes(`ON \`versionless\`.${ROLLUP_TABLE}`),
    );

    // Both CREATE and ALTER, so an older deploy's policy is updated in place.
    expect(rollupPolicies).toHaveLength(2);
    for (const statement of rollupPolicies) {
      // The rollup has no ResourceAttributes map — filtering on it would
      // reference a missing column and leave the table open across tenants.
      expect(statement).not.toContain("ResourceAttributes");
      expect(statement).toContain(
        "project_id = getSetting('SQL_project_id')",
      );
      expect(statement).toContain("team_id = getSetting('SQL_team_id')");
      expect(statement).toContain(`TO ${QUERY_USER}`);
    }

    // Every table the restricted user can read must carry a policy: a GRANT
    // without one is an unrestricted cross-tenant read.
    const granted = statements
      .map((statement) =>
        /GRANT SELECT ON `versionless`\.(\w+)/.exec(statement)?.[1],
      )
      .filter((table): table is string => Boolean(table));
    expect(granted).toContain(ROLLUP_TABLE);
    for (const table of granted) {
      expect(
        policies.some((statement) =>
          statement.includes(`ON \`versionless\`.${table} `),
        ),
      ).toBeTrue();
    }
  });

  test("keeps rollup tenancy columns in the key so merges cannot mix tenants", () => {
    const create = queryAccessStatements("versionless").find((statement) =>
      statement.startsWith(`CREATE TABLE IF NOT EXISTS \`versionless\`.${ROLLUP_TABLE}`),
    )!;

    expect(create).toContain("ENGINE = AggregatingMergeTree()");
    // AggregatingMergeTree merges rows sharing an ORDER BY key. Tenancy must
    // lead that key, or two tenants' rows for the same day could combine.
    expect(create).toContain(
      "ORDER BY (team_id, project_id, day, version, route, method)",
    );
    // Mergeable states, not finalized values — a daily row is later merged
    // across days by the dashboard.
    expect(create).toContain(
      "latency AggregateFunction(quantilesTDigest(0.5, 0.95, 0.99), Float64)",
    );
    expect(create).toContain("consumers AggregateFunction(uniq, String)");
  });

  test("derives the rollup from the unsampled request log", () => {
    const sql = queryAccessStatements("versionless").join("\n");

    // Traces head-sample at 10%; a rollup built from them would bake the same
    // 10x undercount the error queries were just moved off.
    expect(sql).toContain("FROM `versionless`.otel_logs");
    expect(sql).not.toContain("FROM `versionless`.otel_traces");
    expect(sql).toContain("EventName = 'versionless.request'");
    expect(sql).toContain("countIf(toUInt16OrZero");
  });

  test("widens a rollup an earlier deploy already created", () => {
    const statements = queryAccessStatements("versionless");
    const alters = statements.filter((statement) =>
      statement.startsWith(
        `ALTER TABLE \`versionless\`.${ROLLUP_TABLE} ADD COLUMN`,
      ),
    );

    // CREATE TABLE IF NOT EXISTS is a no-op against an existing table, so a
    // column added after the first generation only ever arrives via ALTER.
    // Without these the MV insert fails on an unknown column and the rollup
    // stops accepting rows entirely.
    expect(alters.map((statement) => /ADD COLUMN IF NOT EXISTS (\w+)/.exec(statement)?.[1]))
      .toEqual(["sourced", "unpinned", "clamped"]);

    const create = statements.findIndex((statement) =>
      statement.startsWith("CREATE TABLE IF NOT EXISTS"),
    );
    const view = statements.findIndex((statement) =>
      statement.includes("CREATE MATERIALIZED VIEW"),
    );
    for (const alter of alters) {
      const index = statements.indexOf(alter);
      expect(index).toBeGreaterThan(create);
      // The view writes these columns, so they must exist before it does.
      expect(index).toBeLessThan(view);
    }
  });

  test("retires the previous view generation instead of updating it in place", () => {
    const statements = queryAccessStatements("versionless");
    const created = statements.find((statement) =>
      statement.includes("CREATE MATERIALIZED VIEW"),
    )!;
    const dropped = statements.filter((statement) =>
      statement.startsWith("DROP VIEW IF EXISTS"),
    );

    // A materialized view's SELECT is fixed at creation and IF NOT EXISTS will
    // not rewrite it, so a widened rollup needs a new generation name.
    expect(created).toContain("versionless_rollup_daily_mv_v2");
    expect(dropped).toEqual([
      "DROP VIEW IF EXISTS `versionless`.versionless_rollup_daily_mv",
    ]);
    // Dropping the generation we are about to create would leave no view at
    // all on every restart.
    for (const drop of dropped) {
      expect(drop).not.toContain("versionless_rollup_daily_mv_v2");
    }
  });

  test("counts clamped requests the way the Collector writes them", () => {
    const sql = queryAccessStatements("versionless").join("\n");

    // `LogAttributes` is Map(String, String) and the Collector stringifies the
    // OTLP boolValue the SDK emits, so the predicate compares against 'true'.
    // Comparing against a bool literal would silently count zero forever.
    expect(sql).toContain(
      "countIf(LogAttributes['versionless.clamped'] = 'true') AS clamped",
    );
    // `sourced` counts requests that recorded a source at all, which is what
    // lets the overview separate "no client pinned" from "we never recorded it"
    // on days rolled up before the attribute existed.
    expect(sql).toContain(
      "countIf(notEmpty(LogAttributes['versionless.version.source'])) AS sourced",
    );
    expect(sql).toContain(
      "countIf(LogAttributes['versionless.version.source'] = 'default') AS unpinned",
    );
  });

  test("backfills once without racing live inserts", async () => {
    const executed: string[] = [];
    await provisionQueryAccess(
      {
        async command({ query }) {
          executed.push(query);
          return undefined;
        },
      },
      "versionless",
      "pw",
    );

    const backfill = executed.find((query) =>
      query.startsWith("INSERT INTO `versionless`.versionless_rollup_daily"),
    )!;
    const mvIndex = executed.findIndex((query) =>
      query.includes("CREATE MATERIALIZED VIEW"),
    );

    // The MV must exist first, or rows arriving during the backfill are lost.
    expect(mvIndex).toBeLessThan(executed.indexOf(backfill));
    // Re-running provisioning must not double-count, and the guard must not be
    // trippable by traffic landing on today between the two statements.
    expect(backfill).toContain("Timestamp < toDateTime(today())");
    expect(backfill).toContain("WHERE day < today()) = 0");
  });

  test("executes arbitrary SQL with trusted tenancy and resource settings", async () => {
    let captured: Parameters<RestrictedQueryClient["query"]>[0] | undefined;
    const client: RestrictedQueryClient = {
      async query(options) {
        captured = options;
        return {
          async json<T>() {
            return [{ total: 42 }] as T[];
          },
        };
      },
    };

    const response = await executeProjectQuery(
      {
        projectId: "11111111-1111-4111-8111-111111111111",
        teamId: "team_1",
        query: "SELECT count() AS total FROM otel_logs",
        timeoutMs: 120_000,
      },
      {
        ensureAccess: async () => {},
        client,
      },
    );

    expect(response.result).toEqual([{ total: 42 }]);
    expect(response.queryId).toStartWith(
      "11111111-1111-4111-8111-111111111111:",
    );
    expect(captured?.query).toContain("FROM otel_logs");
    expect(captured?.clickhouse_settings).toMatchObject({
      SQL_project_id: "11111111-1111-4111-8111-111111111111",
      SQL_team_id: "team_1",
      readonly: "1",
      allow_ddl: 0,
      max_execution_time: 60,
      max_result_rows: String(MAX_RESULT_ROWS),
      max_result_bytes: String(MAX_RESULT_BYTES),
      result_overflow_mode: "throw",
    });
  });
});
