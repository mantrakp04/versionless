import { Badge } from "@versionless/ui/components/badge";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { cn } from "@versionless/ui/lib/utils";
import type { ReactNode } from "react";

import type { StatTone } from "./report-section";

/**
 * Building blocks for the overview's card layout.
 *
 * The overview shows nine readings at once, so each needs to be legible at a
 * glance without being opened. A stat tile is the smallest unit: a number, what
 * it measures, and a one-word state. The verdict wording still comes from
 * `overview-verdicts.ts` — this file only decides how it looks.
 */

const TONE_BADGE: Record<StatTone, string> = {
  neutral: "border-border bg-muted/60 text-foreground/80",
  positive:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  negative:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  muted: "border-border/60 bg-transparent text-muted-foreground",
};

const TONE_VALUE: Record<StatTone, string> = {
  neutral: "text-foreground",
  positive: "text-foreground",
  negative: "text-amber-600 dark:text-amber-400",
  muted: "text-muted-foreground",
};

/** The one-word state of a reading, coloured by how much it should worry you. */
export function VerdictBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "border font-semibold tracking-[0.08em] uppercase",
        TONE_BADGE[tone],
        className,
      )}
      variant="outline"
    >
      {children}
    </Badge>
  );
}

/**
 * One reading: a big number, the question it answers, and the state it is in.
 *
 * `isLoading` renders a skeleton of the same height rather than collapsing the
 * tile, so the grid does not reflow as the nine queries land at different
 * times.
 */
export function StatTile({
  label,
  value,
  hint,
  verdict,
  tone = "neutral",
  visual,
  isLoading = false,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  verdict?: string;
  tone?: StatTone;
  visual?: ReactNode;
  isLoading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[6.5rem] flex-col justify-between gap-3 rounded-lg bg-muted/35 p-3.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[0.625rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
          {label}
        </span>
        {isLoading ? (
          <Skeleton className="h-4 w-14 rounded-full" />
        ) : verdict ? (
          <VerdictBadge tone={tone}>{verdict}</VerdictBadge>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
      ) : (
        <div className="space-y-1">
          <div
            className={cn(
              "font-mono text-2xl leading-none font-medium tabular-nums",
              TONE_VALUE[tone],
            )}
          >
            {value}
          </div>
          {hint ? (
            <div className="text-[0.6875rem] leading-relaxed text-muted-foreground">
              {hint}
            </div>
          ) : null}
          {visual}
        </div>
      )}
    </div>
  );
}

/** A labelled figure inside a card body, smaller than a tile. */
export function Figure({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.625rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-lg leading-none font-medium tabular-nums",
          TONE_VALUE[tone],
        )}
      >
        {value}
      </div>
      {note ? (
        <div className="mt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
          {note}
        </div>
      ) : null}
    </div>
  );
}

export function FigureRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-x-10 gap-y-4", className)}>
      {children}
    </div>
  );
}

/**
 * Says why a number is missing instead of rendering a confident zero. "No
 * client sent a version pin" and "we never recorded where the pin came from"
 * are different answers, and only one of them is actionable.
 */
export function NotRecorded({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[0.6875rem] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * A horizontal share bar with an inline legend — the two-segment comparison
 * that shows up wherever the page splits traffic in two (current vs legacy,
 * pinned vs unpinned).
 */
export function ShareBar({
  segments,
  className,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  className?: string;
}) {
  const total = Math.max(
    segments.reduce((sum, segment) => sum + segment.value, 0),
    1,
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((segment) => (
          <span
            className="h-full first:rounded-l-full last:rounded-r-full"
            key={segment.label}
            style={{
              backgroundColor: segment.color,
              width: `${(segment.value / total) * 100}%`,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <span
            className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground"
            key={segment.label}
          >
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: segment.color }}
            />
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  );
}
