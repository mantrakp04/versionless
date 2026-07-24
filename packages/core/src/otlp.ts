import type { TelemetryEvent } from "./types";
import type { CapturedTrace } from "./trace-capture";

export type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { bytesValue: string }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } };

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpResource {
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

export interface OtlpInstrumentationScope {
  name?: string;
  version?: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

export interface OtlpLogRecord {
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  severityNumber?: number;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
  flags?: number;
  traceId?: string;
  spanId?: string;
  eventName?: string;
}

export interface ExportLogsServiceRequest {
  resourceLogs: Array<{
    resource?: OtlpResource;
    scopeLogs: Array<{
      scope?: OtlpInstrumentationScope;
      logRecords: OtlpLogRecord[];
      schemaUrl?: string;
    }>;
    schemaUrl?: string;
  }>;
}

export interface OtlpSpanEvent {
  timeUnixNano: string;
  name: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

export interface OtlpSpanLink {
  traceId: string;
  spanId: string;
  traceState?: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
  flags?: number;
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  traceState?: string;
  parentSpanId?: string;
  flags?: number;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
  events?: OtlpSpanEvent[];
  droppedEventsCount?: number;
  links?: OtlpSpanLink[];
  droppedLinksCount?: number;
  status?: { message?: string; code?: number };
}

export interface ExportTraceServiceRequest {
  resourceSpans: Array<{
    resource?: OtlpResource;
    scopeSpans: Array<{
      scope?: OtlpInstrumentationScope;
      spans: OtlpSpan[];
      schemaUrl?: string;
    }>;
    schemaUrl?: string;
  }>;
}

const SCOPE: OtlpInstrumentationScope = {
  name: "@versionless/core",
};

function otlpValue(value: string | number | boolean): OtlpAnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value };
}

function otlpAttributes(
  values: Record<string, string | number | boolean | undefined>,
): OtlpKeyValue[] {
  return Object.entries(values).flatMap(([key, value]) =>
    value === undefined ? [] : [{ key, value: otlpValue(value) }],
  );
}

function otlpResource(project: string): OtlpResource {
  return {
    attributes: otlpAttributes({
      "service.name": project,
      "telemetry.sdk.name": "versionless",
      "telemetry.sdk.language": "typescript",
    }),
  };
}

function unixNano(ms: number): string {
  return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}

export function telemetryEventsToOtlp(
  project: string,
  events: TelemetryEvent[],
): ExportLogsServiceRequest {
  return {
    resourceLogs: [
      {
        resource: otlpResource(project),
        scopeLogs: [
          {
            scope: SCOPE,
            logRecords: events.map((event) => ({
              timeUnixNano: unixNano(event.ts),
              observedTimeUnixNano: unixNano(event.ts),
              severityNumber: 9,
              severityText: "INFO",
              eventName: "versionless.request",
              body: { stringValue: "versionless request exchange" },
              attributes: otlpAttributes({
                "versionless.method": event.method,
                "versionless.route": event.route,
                "versionless.adapter": event.adapter,
                "versionless.version": event.version,
                "versionless.version.requested": event.requestedVersion,
                "versionless.consumer.key": event.consumerKey,
                "versionless.latency_ms": event.latencyMs,
                "versionless.transform_count": event.transformCount,
                "http.response.status_code": event.status,
              }),
            })),
          },
        ],
      },
    ],
  };
}

export function capturedTracesToOtlp(
  project: string,
  traces: CapturedTrace[],
): ExportTraceServiceRequest {
  return {
    resourceSpans: [
      {
        resource: otlpResource(project),
        scopeSpans: [
          {
            scope: SCOPE,
            spans: traces.flatMap((trace) =>
              trace.spans.map((span) => {
                const startTimeUnixNano = unixNano(span.startMs);
                const endTimeUnixNano = unixNano(span.startMs + span.durationMs);
                return {
                  traceId: trace.traceId,
                  spanId: span.spanId,
                  ...(span.parentSpanId
                    ? { parentSpanId: span.parentSpanId }
                    : {}),
                  name: span.name,
                  kind: 1,
                  startTimeUnixNano,
                  endTimeUnixNano,
                  attributes: otlpAttributes(span.attrs),
                  ...(span.error
                    ? {
                        status: { code: 2, message: span.error },
                        events: [
                          {
                            timeUnixNano: endTimeUnixNano,
                            name: "exception",
                            attributes: otlpAttributes({
                              "exception.message": span.error,
                            }),
                          },
                        ],
                      }
                    : {}),
                };
              }),
            ),
          },
        ],
      },
    ],
  };
}
