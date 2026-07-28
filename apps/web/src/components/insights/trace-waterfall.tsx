import { Badge } from "@versionless/ui/components/badge";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { cn } from "@versionless/ui/lib/utils";
import { ChevronRight, ScrollText } from "lucide-react";
import { Fragment, useId, useMemo, useState } from "react";

import { clientErrorMessage } from "@/utils/client-error";

const inlineAttrKeys = [
  "versionless.change",
  "versionless.version.source",
] as const;

export interface WaterfallSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  ts?: string;
  startMs: number;
  durationMs: number;
  hasError: boolean;
  error?: string | null;
  attrs?: Record<string, string | number | boolean>;
}

export interface WaterfallEvent {
  id: string;
  name: string;
  ts?: string;
  startMs: number;
  severity: string;
  errorBody?: {
    code: string;
    message: string;
  } | null;
  parentSpanId?: string | null;
  attrs?: Record<string, string | number | boolean>;
}

type TimelineRow =
  | { kind: "span"; span: WaterfallSpan; depth: number }
  | { kind: "event"; event: WaterfallEvent; depth: number };

const waterfallSkeletonRows = [
  {
    barClassName: "w-full",
    durationClassName: "w-14",
    labelClassName: "w-36",
  },
  {
    barClassName: "w-3/5",
    durationClassName: "w-10",
    labelClassName: "w-44",
  },
  {
    barClassName: "w-2/5",
    durationClassName: "w-12",
    labelClassName: "w-40",
  },
] as const;

interface MetadataEntry {
  label: string;
  value: string;
}

function metadataValue(value: string | number | boolean): string {
  return typeof value === "boolean"
    ? value
      ? "true"
      : "false"
    : String(value);
}

function timestampValue(ts: string | undefined, startMs: number): string {
  if (ts) return ts;
  const date = new Date(startMs);
  return Number.isNaN(date.getTime()) ? String(startMs) : date.toISOString();
}

export function traceTimelineMetadata(
  row: TimelineRow,
  rootStart: number,
): MetadataEntry[] {
  if (row.kind === "event") {
    const event = row.event;
    return [
      { label: "Signal", value: "log event" },
      { label: "Event ID", value: event.id },
      { label: "Timestamp", value: timestampValue(event.ts, event.startMs) },
      {
        label: "Offset",
        value: `+${Math.max(0, event.startMs - rootStart).toFixed(1)} ms`,
      },
      { label: "Severity", value: event.severity || "unspecified" },
      ...(event.errorBody
        ? [
            {
              label: "Error body",
              value: JSON.stringify(event.errorBody),
            },
          ]
        : []),
      ...Object.entries(event.attrs ?? {})
        .filter(([, value]) => value !== "")
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([label, value]) => ({
          label,
          value: metadataValue(value),
        })),
    ];
  }

  const span = row.span;
  return [
    { label: "Signal", value: "span" },
    { label: "Span ID", value: span.spanId },
    { label: "Parent span", value: span.parentSpanId ?? "root" },
    { label: "Started", value: timestampValue(span.ts, span.startMs) },
    {
      label: "Offset",
      value: `+${Math.max(0, span.startMs - rootStart).toFixed(1)} ms`,
    },
    { label: "Duration", value: `${span.durationMs.toFixed(1)} ms` },
    { label: "Status", value: span.hasError ? "error" : "ok" },
    ...(span.hasError
      ? [
          {
            label: "Error",
            value: clientErrorMessage(
              span.error,
              "An error was captured in this span.",
            ),
          },
        ]
      : []),
    ...Object.entries(span.attrs ?? {})
      .filter(([, value]) => value !== "")
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([label, value]) => ({
        label,
        value: metadataValue(value),
      })),
  ];
}

function MetadataPanel({
  entries,
  id,
}: {
  entries: MetadataEntry[];
  id: string;
}) {
  return (
    <div
      aria-label="Timeline item metadata"
      className="ml-5 border-l border-border/80 py-2 pl-4"
      id={id}
      role="region"
    >
      <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[0.6875rem]">
        {entries.map((entry, index) => (
          <Fragment key={`${entry.label}:${index}`}>
            <dt className="truncate text-muted-foreground">{entry.label}</dt>
            <dd className="min-w-0 break-all font-mono text-foreground">
              {entry.value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

export function buildTraceTimeline(
  spans: WaterfallSpan[],
  events: WaterfallEvent[] = [],
): TimelineRow[] {
  if (spans.length === 0) return [];
  const ids = new Set(spans.map((span) => span.spanId));
  const children = new Map<string | null, WaterfallSpan[]>();
  for (const span of spans) {
    const parent =
      span.parentSpanId !== null && ids.has(span.parentSpanId)
        ? span.parentSpanId
        : null;
    const siblings = children.get(parent);
    if (siblings) siblings.push(span);
    else children.set(parent, [span]);
  }

  const rootSpanId =
    spans.find((span) => span.name === "versionless.exchange")?.spanId ??
    spans[0]!.spanId;
  const eventsByParent = new Map<string, WaterfallEvent[]>();
  for (const event of events) {
    const parent =
      event.parentSpanId && ids.has(event.parentSpanId)
        ? event.parentSpanId
        : rootSpanId;
    const siblings = eventsByParent.get(parent);
    if (siblings) siblings.push(event);
    else eventsByParent.set(parent, [event]);
  }

  const rows: TimelineRow[] = [];
  const walk = (span: WaterfallSpan, depth: number) => {
    rows.push({ kind: "span", span, depth });
    const nested = [
      ...(children.get(span.spanId) ?? []).map((child) => ({
        kind: "span" as const,
        startMs: child.startMs,
        child,
      })),
      ...(eventsByParent.get(span.spanId) ?? []).map((event) => ({
        kind: "event" as const,
        startMs: event.startMs,
        event,
      })),
    ].toSorted(
      (left, right) =>
        left.startMs - right.startMs || (left.kind === "event" ? 1 : -1),
    );
    for (const item of nested) {
      if (item.kind === "span") walk(item.child, depth + 1);
      else rows.push({ kind: "event", event: item.event, depth: depth + 1 });
    }
  };
  for (const root of children.get(null) ?? []) walk(root, 0);
  return rows;
}

export function TraceWaterfallSkeleton({
  label = "Loading trace detail",
}: {
  label?: string;
}) {
  return (
    <div aria-label={label} className="space-y-0.5" role="status">
      {waterfallSkeletonRows.map((row, index) => (
        <div
          className="flex h-7 items-center gap-3 px-1 py-0.5"
          key={row.labelClassName}
        >
          <Skeleton className="size-3 shrink-0 rounded-sm" />
          <div
            className="flex w-68 shrink-0 items-center"
            style={{ paddingLeft: index === 0 ? 0 : 16 }}
          >
            <Skeleton className={cn("h-3", row.labelClassName)} />
          </div>
          <div className="relative h-4 flex-1 rounded-sm bg-muted/60">
            <Skeleton className={cn("h-4 rounded-sm", row.barClassName)} />
          </div>
          <div className="flex w-20 shrink-0 justify-end">
            <Skeleton className={cn("h-3", row.durationClassName)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TraceWaterfall({
  emptyState = "No spans recorded for this trace.",
  events = [],
  spans,
}: {
  emptyState?: string;
  events?: WaterfallEvent[];
  spans: WaterfallSpan[];
}) {
  const metadataId = useId();
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const rows = useMemo(
    () => buildTraceTimeline(spans, events),
    [events, spans],
  );

  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {emptyState}
      </p>
    );
  }

  const starts = rows.map((row) =>
    row.kind === "span" ? row.span.startMs : row.event.startMs,
  );
  const rootStart = Math.min(...starts);
  const totalMs = Math.max(
    ...rows.map((row) =>
      row.kind === "span"
        ? row.span.startMs + row.span.durationMs - rootStart
        : row.event.startMs - rootStart,
    ),
    0.001,
  );

  return (
    <div className="space-y-0.5">
      {rows.map((row, index) => {
        const rowKey =
          row.kind === "span"
            ? `span:${row.span.spanId}`
            : `event:${row.event.id}`;
        const expanded = selectedRow === rowKey;
        const panelId = `${metadataId}-metadata-${index}`;

        if (row.kind === "event") {
          const left = ((row.event.startMs - rootStart) / totalMs) * 100;
          return (
            <Fragment key={rowKey}>
              <button
                aria-controls={expanded ? panelId : undefined}
                aria-expanded={expanded}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-sm px-1 py-0.5 text-left text-xs outline-none transition-colors",
                  "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40",
                  expanded && "bg-muted/60",
                )}
                onClick={() =>
                  setSelectedRow((current) =>
                    current === rowKey ? null : rowKey,
                  )
                }
                type="button"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-90",
                  )}
                />
                <div
                  className="flex w-68 shrink-0 items-center gap-2 truncate text-muted-foreground"
                  style={{ paddingLeft: row.depth * 16 }}
                >
                  <ScrollText
                    aria-hidden="true"
                    className="size-3.5 shrink-0"
                  />
                  <span className="truncate font-mono">{row.event.name}</span>
                  <Badge className="ml-auto" variant="secondary">
                    {row.event.severity}
                  </Badge>
                </div>
                <div className="relative h-4 flex-1 rounded-sm bg-muted">
                  <div
                    className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] bg-amber-500 ring-2 ring-background"
                    style={{ left: `${Math.min(Math.max(left, 0), 100)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                  +{Math.max(0, row.event.startMs - rootStart).toFixed(1)} ms
                </span>
              </button>
              {expanded ? (
                <MetadataPanel
                  entries={traceTimelineMetadata(row, rootStart)}
                  id={panelId}
                />
              ) : null}
            </Fragment>
          );
        }

        const { span } = row;
        const left = ((span.startMs - rootStart) / totalMs) * 100;
        const width = (span.durationMs / totalMs) * 100;
        const inlineAttrs = inlineAttrKeys
          .filter((key) => span.attrs?.[key] !== undefined)
          .map(
            (key) =>
              `${key.replace("versionless.", "")}=${String(span.attrs?.[key])}`,
          );
        return (
          <Fragment key={rowKey}>
            <button
              aria-controls={expanded ? panelId : undefined}
              aria-expanded={expanded}
              className={cn(
                "group flex w-full items-center gap-3 rounded-sm px-1 py-0.5 text-left text-xs outline-none transition-colors",
                "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40",
                expanded && "bg-muted/60",
              )}
              onClick={() =>
                setSelectedRow((current) =>
                  current === rowKey ? null : rowKey,
                )
              }
              type="button"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 text-muted-foreground transition-transform",
                  expanded && "rotate-90",
                )}
              />
              <div
                className="flex w-68 shrink-0 items-baseline gap-2 truncate"
                style={{ paddingLeft: row.depth * 16 }}
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
            </button>
            {expanded ? (
              <MetadataPanel
                entries={traceTimelineMetadata(row, rootStart)}
                id={panelId}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
