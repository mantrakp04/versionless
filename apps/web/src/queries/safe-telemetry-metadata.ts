export const SAFE_SPAN_ATTRIBUTES_SQL = `map(
  'http.request.method', SpanAttributes['http.request.method'],
  'server.address', SpanAttributes['server.address'],
  'versionless.adapter', SpanAttributes['versionless.adapter'],
  'versionless.change', SpanAttributes['versionless.change'],
  'versionless.method', SpanAttributes['versionless.method'],
  'versionless.route', SpanAttributes['versionless.route'],
  'versionless.status', SpanAttributes['versionless.status'],
  'versionless.transform_count', SpanAttributes['versionless.transform_count'],
  'versionless.version', SpanAttributes['versionless.version'],
  'versionless.version.source', SpanAttributes['versionless.version.source']
)`;

export const SAFE_AGGREGATED_LOG_ATTRIBUTES_SQL = `map(
  'http.response.status_code', any(LogAttributes['http.response.status_code']),
  'versionless.adapter', any(LogAttributes['versionless.adapter']),
  'versionless.consumer.key', any(LogAttributes['versionless.consumer.key']),
  'versionless.latency_ms', any(LogAttributes['versionless.latency_ms']),
  'versionless.method', any(LogAttributes['versionless.method']),
  'versionless.route', any(LogAttributes['versionless.route']),
  'versionless.transform_count', any(LogAttributes['versionless.transform_count']),
  'versionless.version', any(LogAttributes['versionless.version']),
  'versionless.version.requested', any(LogAttributes['versionless.version.requested'])
)`;

export function parseTelemetryAttributes(
  raw: string,
): Record<string, string | number | boolean> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) =>
          (typeof value === "string" && value !== "") ||
          typeof value === "number" ||
          typeof value === "boolean",
      ),
    ) as Record<string, string | number | boolean>;
  } catch {
    return {};
  }
}
