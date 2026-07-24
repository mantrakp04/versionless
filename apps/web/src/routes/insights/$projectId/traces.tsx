import { useMemo, useState } from "react";
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
import { Label } from "@versionless/ui/components/label";
import { Switch } from "@versionless/ui/components/switch";
import { TableCell, TableHead } from "@versionless/ui/components/table";
import { Activity, CircleAlert } from "lucide-react";

import { relativeTime } from "@/components/insights/format";
import { DashboardTable } from "@/components/dashboard-table";
import { InsightsPage } from "@/components/insights/insights-page";
import {
  OfflineCard,
  isTelemetryOffline,
} from "@/components/insights/offline-card";
import {
  SortableTableHead,
  useTableSort,
} from "@/components/insights/sortable-table-head";
import Loader from "@/components/loader";
import { useInsightsContext } from "@/hooks/use-insights-context";
import {
  traceListQueryOptions,
  traceSpansQueryOptions,
  type TraceSort,
} from "@/queries/traces";
import { clientErrorMessage } from "@/utils/client-error";

export const Route = createFileRoute("/insights/$projectId/traces")({
  component: TracesPage,
});

/** Span attributes worth surfacing inline next to the span name. */
const inlineAttrKeys = [
  "versionless.change",
  "versionless.version.source",
] as const;

interface WaterfallRow<T> {
  span: T;
  depth: number;
}

/**
 * Order spans as a tree walk (children under their parent, original order
 * preserved) and tag each with its depth for indentation. Orphaned spans —
 * a parent id that never arrived — are treated as roots.
 */
function buildWaterfall<
  T extends { spanId: string; parentSpanId: string | null },
>(spans: T[]): WaterfallRow<T>[] {
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string | null, T[]>();
  for (const span of spans) {
    const parent =
      span.parentSpanId !== null && ids.has(span.parentSpanId)
        ? span.parentSpanId
        : null;
    const siblings = children.get(parent);
    if (siblings) siblings.push(span);
    else children.set(parent, [span]);
  }
  const rows: WaterfallRow<T>[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const span of children.get(parent) ?? []) {
      rows.push({ span, depth });
      walk(span.spanId, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

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

  const spans = useQuery({
    ...traceSpansQueryOptions(project.id, selectedTraceId ?? ""),
    enabled: selectedTraceId !== null,
  });

  const rows = traces.data ?? [];
  const offline =
    isTelemetryOffline(traces.error) || isTelemetryOffline(spans.error);
  const offlineError = isTelemetryOffline(traces.error)
    ? traces.error
    : spans.error;

  const sortBy = (nextSort: TraceSort) => {
    setSelectedTraceId(null);
    toggleSort(nextSort);
  };

  return (
    <InsightsPage
      title="Traces"
      description="Sampled versionless spans per request — where time goes inside version resolution and transforms."
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
      ) : traces.isLoading ? (
        <Loader />
      ) : (
        <Card>
          <CardContent>
            {rows.length === 0 ? (
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
                    {import.meta.env.DEV ? (
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
            ) : (
              <DashboardTable
                items={rows}
                getItemKey={(row) => row.traceId}
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
                  spans.isLoading ? (
                    <Loader />
                  ) : (
                    <SpanWaterfall spans={spans.data ?? []} />
                  )
                }
              />
            )}
          </CardContent>
        </Card>
      )}
    </InsightsPage>
  );
}

interface SpanRow {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  ts: string;
  startMs: number;
  durationMs: number;
  hasError: boolean;
  error: string | null;
  attrs: Record<string, string | number | boolean>;
}

function SpanWaterfall({ spans }: { spans: SpanRow[] }) {
  const rows = useMemo(() => buildWaterfall(spans), [spans]);

  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        No spans recorded for this trace.
      </p>
    );
  }

  const root = rows[0]!.span;
  const rootStart = Math.min(...rows.map((r) => r.span.startMs));
  const totalMs = Math.max(
    root.durationMs,
    ...rows.map((r) => r.span.startMs + r.span.durationMs - rootStart),
    0.001,
  );

  return (
    <div className="space-y-1">
      {rows.map(({ span, depth }) => {
        const left = ((span.startMs - rootStart) / totalMs) * 100;
        const width = (span.durationMs / totalMs) * 100;
        const inlineAttrs = inlineAttrKeys
          .filter((key) => span.attrs[key] !== undefined)
          .map(
            (key) =>
              `${key.replace("versionless.", "")}=${String(span.attrs[key])}`,
          );
        return (
          <div key={span.spanId} className="flex items-center gap-3 text-xs">
            <div
              className="flex w-72 shrink-0 items-baseline gap-2 truncate"
              style={{ paddingLeft: depth * 16 }}
            >
              <span
                className={
                  span.hasError
                    ? "font-mono text-red-600 dark:text-red-400"
                    : "font-mono"
                }
              >
                {span.name}
              </span>
              {inlineAttrs.length > 0 ? (
                <span className="truncate text-muted-foreground">
                  {inlineAttrs.join(" ")}
                </span>
              ) : null}
            </div>
            <div className="relative h-4 flex-1 rounded-sm bg-muted">
              <div
                className={
                  span.hasError
                    ? "absolute inset-y-0.5 rounded-sm bg-red-500/80"
                    : "absolute inset-y-0.5 rounded-sm bg-primary/70"
                }
                style={{
                  left: `${Math.min(left, 99)}%`,
                  width: `${width}%`,
                  minWidth: 2,
                }}
              />
            </div>
            <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
              {span.durationMs.toFixed(1)} ms
            </span>
          </div>
        );
      })}
      {rows.some(({ span }) => span.hasError) ? (
        <div className="space-y-0.5 pt-2">
          {rows
            .filter(({ span }) => span.hasError)
            .map(({ span }) => (
              <p
                key={span.spanId}
                className="text-xs text-red-600 dark:text-red-400"
              >
                <span className="font-mono">{span.name}</span>:{" "}
                {clientErrorMessage(
                  span.error,
                  "An error was captured in this span.",
                )}
              </p>
            ))}
        </div>
      ) : null}
    </div>
  );
}
