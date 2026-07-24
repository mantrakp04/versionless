import { projectQueryOptions } from "@/utils/project-query";

export type TelemetrySignal = "all" | "log" | "span";

export interface TelemetryRecord {
  signal: "log" | "span";
  ts: string;
  name: string;
  serviceName: string;
  scopeName: string;
  levelText: string;
  levelNumber: number;
  traceId: string;
  spanId: string;
  durationMs: number;
  body: string;
  attributes: string;
  error: string;
}

export function telemetryQueryOptions(input: {
  projectId: string;
  hours: number;
  signal: TelemetrySignal;
  limit: number;
}) {
  const branches: string[] = [];
  if (input.signal !== "span") {
    branches.push(`SELECT 'log' AS signal, Timestamp AS ts,
  if(EventName != '', EventName, 'log') AS name, ServiceName AS service_name,
  ScopeName AS scope_name, SeverityText AS level_text,
  SeverityNumber AS level_number, TraceId AS trace_id, SpanId AS span_id,
  toFloat64(0) AS duration_ms, Body AS body,
  toJSONString(LogAttributes) AS attributes, '' AS error
FROM otel_logs
WHERE Timestamp >= now() - INTERVAL {hours: UInt16} HOUR`);
  }
  if (input.signal !== "log") {
    branches.push(`SELECT 'span' AS signal, Timestamp AS ts, SpanName AS name,
  ServiceName AS service_name, ScopeName AS scope_name,
  if(StatusCode = 'Error', 'ERROR', '') AS level_text,
  if(StatusCode = 'Error', 2, if(StatusCode = 'Ok', 1, 0)) AS level_number,
  TraceId AS trace_id, SpanId AS span_id, Duration / 1000000 AS duration_ms,
  '' AS body, toJSONString(SpanAttributes) AS attributes,
  if(StatusCode = 'Error', StatusMessage, '') AS error
FROM otel_traces
WHERE Timestamp >= now() - INTERVAL {hours: UInt16} HOUR`);
  }

  return projectQueryOptions<
    {
      signal: "log" | "span";
      ts: string;
      name: string;
      service_name: string;
      scope_name: string;
      level_text: string;
      level_number: string | number;
      trace_id: string;
      span_id: string;
      duration_ms: string | number;
      body: string;
      attributes: string;
      error: string;
    },
    TelemetryRecord[]
  >(
    "telemetry",
    {
      projectId: input.projectId,
      query: `SELECT *
FROM (${branches.join("\nUNION ALL\n")})
ORDER BY ts DESC, signal ASC, span_id ASC
LIMIT {limit: UInt16}`,
      params: { hours: input.hours, limit: input.limit },
    },
    (rows) =>
      rows.map((row) => ({
        signal: row.signal,
        ts: row.ts,
        name: row.name,
        serviceName: row.service_name,
        scopeName: row.scope_name,
        levelText: row.level_text,
        levelNumber: Number(row.level_number),
        traceId: row.trace_id,
        spanId: row.span_id,
        durationMs: Number(row.duration_ms),
        body: row.body,
        attributes: row.attributes,
        error: row.error,
      })),
  );
}
