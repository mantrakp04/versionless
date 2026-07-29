import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@versionless/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@versionless/ui/components/empty";
import { env } from "@versionless/env/vite";
import { Label } from "@versionless/ui/components/label";
import { Switch } from "@versionless/ui/components/switch";
import { TableCell, TableHead } from "@versionless/ui/components/table";
import { Activity, CircleAlert } from "lucide-react";

import { relativeTime } from "@/components/insights/format";
import { DashboardTable } from "@/components/dashboard-table";
import { InsightsPage } from "@/components/insights/insights-page";
import {
  TraceWaterfall,
  TraceWaterfallSkeleton,
} from "@/components/insights/trace-waterfall";
import {
  OfflineCard,
  isTelemetryOffline,
} from "@/components/insights/offline-card";
import {
  SortableTableHead,
  useTableSort,
} from "@/components/insights/sortable-table-head";
import { useInsightsContext } from "@/hooks/use-insights-context";
import {
  traceListQueryOptions,
  traceEventsQueryOptions,
  traceSpansQueryOptions,
  type TraceSort,
} from "@/queries/traces";

export const Route = createFileRoute("/insights/$projectId/traces")({
  component: TracesPage,
});

const TRACE_GRID_COLUMNS =
  "minmax(6.5rem, .8fr) minmax(12rem, 1.8fr) minmax(7rem, .9fr) .55fr .7fr .5fr 2rem";

function TracesPage() {
  const { project, days } = useInsightsContext();
  const hours = days * 24;
  const [errorsOnly, setErrorsOnly] = useState(false);
  const { sort, direction, toggleSort } = useTableSort<TraceSort>(
    "time",
    (column) => (column === "time" ? "desc" : "asc"),
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const traces = useQuery(
    traceListQueryOptions({
      hours,
      errorsOnly,
      projectId: project.id,
      sort,
      direction,
    }),
  );
  const rows = traces.data ?? [];
  const selectedTrace =
    rows.find((trace) => trace.traceId === selectedTraceId) ?? null;

  const spans = useQuery({
    ...traceSpansQueryOptions(project.id, selectedTrace),
    enabled: selectedTrace !== null,
  });
  const events = useQuery({
    ...traceEventsQueryOptions(project.id, selectedTrace),
    enabled: selectedTrace !== null,
  });

  const offline =
    isTelemetryOffline(traces.error) ||
    isTelemetryOffline(spans.error) ||
    isTelemetryOffline(events.error);
  const offlineError = isTelemetryOffline(traces.error)
    ? traces.error
    : isTelemetryOffline(spans.error)
      ? spans.error
      : events.error;

  const sortBy = (nextSort: TraceSort) => {
    setSelectedTraceId(null);
    toggleSort(nextSort);
  };

  return (
    <InsightsPage
      title="Traces"
      controls={
        <div className="flex items-center gap-2">
          <Switch
            id="errors-only"
            checked={errorsOnly}
            onCheckedChange={setErrorsOnly}
          />
          <Label htmlFor="errors-only" className="text-xs">
            Errors only
          </Label>
        </div>
      }
    >
      {offline ? (
        <OfflineCard error={offlineError} />
      ) : (
        <Card>
          <CardContent>
            <DashboardTable
              items={rows}
              isLoading={traces.isLoading}
              isError={traces.isError}
              errorState="Traces are temporarily unavailable."
              emptyState={
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Activity />
                    </EmptyMedia>
                    <EmptyTitle>No traces yet</EmptyTitle>
                    <EmptyDescription>
                      Traces appear once the SDK ships sampled traces — add a
                      <code className="font-mono"> traces</code> config with an
                      <code className="font-mono"> apiKey</code> to your
                      <code className="font-mono"> createVersionless</code>{" "}
                      constructor.
                      {env.DEV ? (
                        <>
                          {" "}
                          For local demo data, run
                          <code className="font-mono">
                            {" "}
                            bun run --cwd apps/server seed
                          </code>
                          .
                        </>
                      ) : null}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              }
              getItemKey={(row) => row.traceId}
              gridTemplateColumns={TRACE_GRID_COLUMNS}
              navigationKey={`traces:${project.id}:${hours}:${errorsOnly}:${sort}:${direction}`}
              selectedKey={selectedTraceId}
              onRowActivate={(row) =>
                setSelectedTraceId((current) =>
                  current === row.traceId ? null : row.traceId,
                )
              }
              isRowExpanded={(row) => row.traceId === selectedTraceId}
              columnCount={7}
              expandedCellClassName="bg-muted/30 p-4"
              renderHeader={() => (
                <>
                  <SortableTableHead
                    label="Time"
                    column="time"
                    sort={sort}
                    direction={direction}
                    onSort={sortBy}
                  />
                  <SortableTableHead
                    label="Route"
                    column="route"
                    sort={sort}
                    direction={direction}
                    onSort={sortBy}
                  />
                  <SortableTableHead
                    label="Version"
                    column="version"
                    sort={sort}
                    direction={direction}
                    onSort={sortBy}
                  />
                  <SortableTableHead
                    label="Status"
                    column="status"
                    sort={sort}
                    direction={direction}
                    onSort={sortBy}
                    align="right"
                  />
                  <SortableTableHead
                    label="Duration"
                    column="duration"
                    sort={sort}
                    direction={direction}
                    onSort={sortBy}
                    align="right"
                  />
                  <SortableTableHead
                    label="Spans"
                    column="spans"
                    sort={sort}
                    direction={direction}
                    onSort={sortBy}
                    align="right"
                  />
                  <TableHead className="w-8" />
                </>
              )}
              renderRow={(row) => (
                <>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {relativeTime(row.ts)}
                  </TableCell>
                  <TableCell className="font-mono">{row.route}</TableCell>
                  <TableCell className="font-mono">{row.version}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span
                      className={
                        row.status >= 500
                          ? "text-red-600 dark:text-red-400"
                          : row.status >= 400
                            ? "text-amber-600 dark:text-amber-400"
                            : undefined
                      }
                    >
                      {row.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.durationMs.toFixed(1)} ms
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.spanCount}
                  </TableCell>
                  <TableCell>
                    {row.hasError ? (
                      <CircleAlert className="size-4 text-red-600 dark:text-red-400" />
                    ) : null}
                  </TableCell>
                </>
              )}
              renderExpandedRow={() =>
                spans.isLoading || events.isLoading ? (
                  <TraceWaterfallSkeleton />
                ) : (
                  <TraceWaterfall
                    events={(events.data ?? []).map((event) => ({
                      ...event,
                      parentSpanId:
                        spans.data?.find(
                          (span) => span.name === "versionless.exchange",
                        )?.spanId ?? null,
                    }))}
                    spans={spans.data ?? []}
                  />
                )
              }
            />
          </CardContent>
        </Card>
      )}
    </InsightsPage>
  );
}
