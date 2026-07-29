import { describe, expect, test } from "bun:test";
import { telemetryQueryOptions, type TelemetrySignal } from "./telemetry";

const projectId = "11111111-1111-4111-8111-111111111111";

function sqlFor(signal: TelemetrySignal): string {
  const options = telemetryQueryOptions({
    projectId,
    hours: 24,
    signal,
    limit: 100,
  });
  return options.queryKey[3] as string;
}

describe("telemetry query", () => {
  test("prunes by time and bounds each source before merging it", () => {
    const sql = sqlFor("all");

    expect(sql.match(/PREWHERE Timestamp >=/g)).toHaveLength(2);
    expect(sql.match(/LIMIT \{limit: UInt16\}/g)).toHaveLength(4);
    expect(sql).toContain("ORDER BY Timestamp DESC, SpanId ASC, TraceId DESC");
    expect(sql).toContain("UNION ALL");
  });

  test("serializes only the final bounded rows", () => {
    const sql = sqlFor("all");
    const serialization = sql.indexOf("toJSONString(attributes_map)");
    const union = sql.indexOf("UNION ALL");

    expect(serialization).toBeGreaterThanOrEqual(0);
    expect(serialization).toBeLessThan(union);
    expect(sql.match(/toJSONString/g)).toHaveLength(1);
    expect(sql).not.toContain("toJSONString(LogAttributes)");
    expect(sql).not.toContain("toJSONString(SpanAttributes)");
  });

  test("does not read the unselected signal table", () => {
    expect(sqlFor("log")).toContain("FROM otel_logs");
    expect(sqlFor("log")).not.toContain("FROM otel_traces");
    expect(sqlFor("span")).toContain("FROM otel_traces");
    expect(sqlFor("span")).not.toContain("FROM otel_logs");
  });
});
