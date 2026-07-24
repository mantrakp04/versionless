import { describe, expect, test } from "bun:test";
import {
  executeProjectQuery,
  MAX_RESULT_BYTES,
  MAX_RESULT_ROWS,
  queryAccessStatements,
  type RestrictedQueryClient,
} from "./clickhouse-query";

describe("tenant-isolated ClickHouse queries", () => {
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
