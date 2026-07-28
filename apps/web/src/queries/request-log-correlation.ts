import { SAFE_AGGREGATED_LOG_ATTRIBUTES_SQL } from "@/queries/safe-telemetry-metadata";

export interface RequestLogCorrelation {
  ts: string;
  durationMs: number;
  version: string;
  route: string;
  status: number;
}

export interface RequestLogErrorBody {
  code: string;
  message: string;
}

export function requestLogErrorBody(row: {
  error_code: string;
  error_message: string;
}): RequestLogErrorBody | null {
  return row.error_code && row.error_message
    ? { code: row.error_code, message: row.error_message }
    : null;
}

export function requestLogCorrelationParams(
  trace: RequestLogCorrelation | null,
) {
  return {
    startedAt: trace?.ts ?? "",
    durationMs: trace?.durationMs ?? 0,
    version: trace?.version ?? "",
    route: trace?.route ?? "",
    status: trace?.status ?? 0,
  };
}

/**
 * Request spans start when an exchange opens; request logs are emitted when it
 * finishes. Correlate at start + duration and choose the closest matching log
 * from a bounded window so concurrent traffic cannot widen the detail scan.
 */
export function correlatedRequestLogSql(options?: {
  includeErrorSummary?: boolean;
}): string {
  const errorSummary = options?.includeErrorSummary
    ? `if(
         isValidJSON(any(Body)),
         leftUTF8(JSONExtractString(any(Body), 'code'), 64),
         ''
       ) AS error_code,
       if(
         isValidJSON(any(Body)),
         leftUTF8(JSONExtractString(any(Body), 'message'), 280),
         ''
       ) AS error_message,`
    : `'' AS error_code,
       '' AS error_message,`;
  const bodyColumn = options?.includeErrorSummary ? ", Body" : "";

  return `SELECT any(Timestamp) AS ts,
       toUnixTimestamp64Milli(any(Timestamp)) AS start_ms,
       any(EventName) AS event_name,
       if(max(SeverityNumber) >= 17, 'ERROR', any(SeverityText)) AS severity,
       ${errorSummary}
       toJSONString(${SAFE_AGGREGATED_LOG_ATTRIBUTES_SQL}) AS attrs
FROM (
  SELECT Timestamp, EventName, SeverityNumber, SeverityText${bodyColumn},
         LogAttributes
  FROM otel_logs
  PREWHERE Timestamp >= addMilliseconds(
      parseDateTime64BestEffort({startedAt: String}),
      toInt64(round({durationMs: Float64}))
    ) - INTERVAL 1 SECOND
    AND Timestamp <= addMilliseconds(
      parseDateTime64BestEffort({startedAt: String}),
      toInt64(round({durationMs: Float64}))
    ) + INTERVAL 1 SECOND
  WHERE EventName = 'versionless.request'
    AND LogAttributes['versionless.version'] = {version: String}
    AND LogAttributes['versionless.route'] = {route: String}
    AND toUInt16OrZero(LogAttributes['http.response.status_code']) = {status: UInt16}
  ORDER BY abs(dateDiff('millisecond', addMilliseconds(
    parseDateTime64BestEffort({startedAt: String}),
    toInt64(round({durationMs: Float64}))
  ), Timestamp)), Timestamp ASC
  LIMIT 1
)
GROUP BY toUnixTimestamp64Milli(Timestamp)`;
}
