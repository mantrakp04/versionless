import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@versionless/ui/components/badge";
import { Card, CardContent } from "@versionless/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@versionless/ui/components/empty";
import {
  NativeSelect,
  NativeSelectOption,
} from "@versionless/ui/components/native-select";
import { TableCell, TableHead } from "@versionless/ui/components/table";
import { RadioTower } from "lucide-react";

import { relativeTime } from "@/components/insights/format";
import { DashboardTable } from "@/components/dashboard-table";
import { InsightsPage } from "@/components/insights/insights-page";
import {
  isTelemetryOffline,
  OfflineCard,
} from "@/components/insights/offline-card";
import Loader from "@/components/loader";
import { useInsightsContext } from "@/hooks/use-insights-context";
import {
  telemetryQueryOptions,
  type TelemetryRecord,
  type TelemetrySignal,
} from "@/queries/telemetry";

export const Route = createFileRoute("/insights/$projectId/telemetry")({
  component: TelemetryPage,
});

export function displayOtlpBody(body: string): string {
  if (body === "") return "";
  try {
    const value = JSON.parse(body) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "stringValue" in value &&
      typeof value.stringValue === "string"
    ) {
      return value.stringValue;
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return body;
  }
}

function shortId(value: string): string {
  return value === "" ? "—" : value.slice(0, 8);
}

function telemetryRecordKey(
  record: TelemetryRecord,
  index: number,
): string {
  const logicalKey = [
    record.signal,
    record.ts,
    record.traceId,
    record.spanId,
    record.name,
  ].join(":");
  return `${logicalKey}:${index}`;
}

function formatDuration(value: number): string {
  if (value <= 0) return "—";
  if (value < 1) return `${Math.round(value * 1_000)} µs`;
  if (value < 1_000) return `${value.toFixed(1)} ms`;
  return `${(value / 1_000).toFixed(2)} s`;
}

function recordDetail(record: TelemetryRecord): string {
  const attributes = (() => {
    try {
      return JSON.stringify(JSON.parse(record.attributes), null, 2);
    } catch {
      return record.attributes;
    }
  })();

  return [
    record.body ? `body:\n${displayOtlpBody(record.body)}` : "",
    record.error ? `error:\n${record.error}` : "",
    record.traceId ? `trace_id: ${record.traceId}` : "",
    record.spanId ? `span_id: ${record.spanId}` : "",
    attributes ? `attributes:\n${attributes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function TelemetryPage() {
  const { project, days } = useInsightsContext();
  const [signal, setSignal] = useState<TelemetrySignal>("all");
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null);
  const hours = days * 24;

  const records = useQuery(
    telemetryQueryOptions({
      hours,
      signal,
      limit: 100,
      projectId: project.id,
    }),
  );
  const rows = records.data ?? [];

  return (
    <InsightsPage
      title="Telemetry"
      description="Every OTLP log and span received for this project, including records that are not emitted by Versionless."
      maxWidth="6xl"
      controls={
        <NativeSelect
          aria-label="Signal type"
          value={signal}
          onChange={(event) => {
            setSignal(event.target.value as TelemetrySignal);
            setSelectedRecord(null);
          }}
        >
          <NativeSelectOption value="all">Logs and spans</NativeSelectOption>
          <NativeSelectOption value="log">Logs</NativeSelectOption>
          <NativeSelectOption value="span">Spans</NativeSelectOption>
        </NativeSelect>
      }
    >
      {isTelemetryOffline(records.error) ? (
        <OfflineCard error={records.error} />
      ) : records.isLoading ? (
        <Loader />
      ) : (
        <Card>
          <CardContent>
            {rows.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <RadioTower />
                  </EmptyMedia>
                  <EmptyTitle>No telemetry yet</EmptyTitle>
                  <EmptyDescription>
                    Export OTLP logs or traces to this project and they will
                    appear here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <DashboardTable
                items={rows}
                getItemKey={telemetryRecordKey}
                selectedKey={selectedRecord}
                onRowActivate={(record, index) => {
                  const key = telemetryRecordKey(record, index);
                  setSelectedRecord((current) =>
                    current === key ? null : key,
                  );
                }}
                isRowExpanded={(record, index) =>
                  selectedRecord === telemetryRecordKey(record, index)
                }
                columnCount={7}
                renderHeader={() => (
                  <>
                    <TableHead>Time</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Level / duration</TableHead>
                    <TableHead>Trace</TableHead>
                  </>
                )}
                renderRow={(record) => (
                  <>
                    <TableCell className="whitespace-nowrap">
                      {relativeTime(record.ts)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          record.signal === "span" ? "default" : "secondary"
                        }
                      >
                        {record.signal}
                      </Badge>
                    </TableCell>
                    <TableCell>{record.serviceName || "—"}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs">
                      {record.name}
                    </TableCell>
                    <TableCell>{record.scopeName || "—"}</TableCell>
                    <TableCell>
                      {record.signal === "span"
                        ? formatDuration(record.durationMs)
                        : record.levelText || record.levelNumber || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {shortId(record.traceId)}
                    </TableCell>
                  </>
                )}
                renderExpandedRow={(record) => (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-xs">
                    {recordDetail(record) || "No record details"}
                  </pre>
                )}
              />
            )}
          </CardContent>
        </Card>
      )}
    </InsightsPage>
  );
}
