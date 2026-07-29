import { Badge } from "@versionless/ui/components/badge";
import { Button } from "@versionless/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@versionless/ui/components/collapsible";
import { cn } from "@versionless/ui/lib/utils";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ReportContextValue {
  isOpen: (id: string, sectionDefault: boolean) => boolean;
  setOpen: (id: string, open: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
  allExpanded: boolean;
}

const ReportContext = createContext<ReportContextValue | null>(null);

/**
 * Sections read as a document: closed by default, each showing its verdict and
 * hero number so the whole report is skimmable before anything is expanded.
 * `baseline` is the expand-all/collapse-all override; per-section toggles
 * live in `overrides` and win over it.
 */
export function Report({
  children,
  className,
  defaultExpanded = false,
}: {
  children: ReactNode;
  className?: string;
  defaultExpanded?: boolean;
}) {
  const [state, setState] = useState<{
    baseline: boolean | null;
    overrides: Record<string, boolean>;
  }>({ baseline: defaultExpanded ? true : null, overrides: {} });

  const isOpen = useCallback(
    (id: string, sectionDefault: boolean) =>
      state.overrides[id] ?? state.baseline ?? sectionDefault,
    [state],
  );
  const setOpen = useCallback((id: string, open: boolean) => {
    setState((current) => ({
      baseline: current.baseline,
      overrides: { ...current.overrides, [id]: open },
    }));
  }, []);
  const expandAll = useCallback(
    () => setState({ baseline: true, overrides: {} }),
    [],
  );
  const collapseAll = useCallback(
    () => setState({ baseline: false, overrides: {} }),
    [],
  );

  const value = useMemo(
    () => ({
      isOpen,
      setOpen,
      expandAll,
      collapseAll,
      allExpanded: state.baseline === true,
    }),
    [collapseAll, expandAll, isOpen, setOpen, state.baseline],
  );

  return (
    <ReportContext.Provider value={value}>
      <div className={cn("flex flex-col", className)}>{children}</div>
    </ReportContext.Provider>
  );
}

export function ReportControls({ className }: { className?: string }) {
  const report = useContext(ReportContext);
  if (!report) return null;

  return (
    <Button
      className={className}
      onClick={report.allExpanded ? report.collapseAll : report.expandAll}
      size="sm"
      type="button"
      variant="ghost"
    >
      {report.allExpanded ? (
        <ChevronsDownUp aria-hidden="true" />
      ) : (
        <ChevronsUpDown aria-hidden="true" />
      )}
      {report.allExpanded ? "Collapse all" : "Expand all"}
    </Button>
  );
}

export function ReportLead({
  headline,
  className,
  children,
}: {
  /** One short sentence. Anything longer belongs in a section. */
  headline: string;
  className?: string;
  /** Headline figures, rendered as a strip beneath the sentence. */
  children?: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-sm text-foreground/85">{headline}</p>
      {children ? (
        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A single headline figure in the lead strip: big number, quiet label. */
export function ReportHeadlineStat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div>
      <div className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-medium tracking-tight tabular-nums">
          {value}
        </span>
        {hint ? (
          <span className={cn("text-xs tabular-nums", TONE_TEXT[tone])}>
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export type StatTone = "neutral" | "positive" | "negative" | "muted";

const TONE_TEXT: Record<StatTone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-amber-600 dark:text-amber-400",
  muted: "text-muted-foreground/70",
};

const VERDICT_CHIP: Record<StatTone, string> = {
  neutral: "border-border bg-muted/60 text-foreground/80",
  positive:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  negative:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  muted: "border-border/60 bg-transparent text-muted-foreground",
};

/** The one-word state of a section, standing in for a sentence. */
export function ReportVerdict({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatTone;
}) {
  return (
    <Badge
      className={cn(
        "border px-2.5 font-semibold tracking-[0.1em] uppercase",
        VERDICT_CHIP[tone],
      )}
      variant="outline"
    >
      {children}
    </Badge>
  );
}

export function ReportGroupHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-6 pb-2 first:pt-1">
      <h3 className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {children}
      </h3>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * A collapsed row states its case without prose: a verdict chip, one hero
 * number with an optional qualifier, and a small visual on the right.
 */
export function ReportSection({
  id,
  index,
  title,
  verdict,
  verdictTone = "neutral",
  metric,
  metricLabel,
  qualifier,
  visual,
  defaultOpen = false,
  children,
}: {
  id: string;
  index: string;
  title: string;
  /** One word for the section's state, e.g. "Growing". */
  verdict: string;
  verdictTone?: StatTone;
  /** The single number that matters when the section is closed. */
  metric: ReactNode;
  metricLabel: string;
  /** Short trailing qualifier, e.g. "+13" or "12% of traffic". */
  qualifier?: ReactNode;
  /** Sparkline, split bar, or bars — shape only, no axis labels. */
  visual?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const report = useContext(ReportContext);
  const [local, setLocal] = useState(defaultOpen);
  const open = report ? report.isOpen(id, defaultOpen) : local;
  const handleOpenChange = (next: boolean) => {
    if (report) report.setOpen(id, next);
    else setLocal(next);
  };

  return (
    <Collapsible
      onOpenChange={handleOpenChange}
      open={open}
      render={<section className="border-b last:border-b-0" />}
    >
      <CollapsibleTrigger className="group/report-section flex w-full items-center gap-4 rounded-lg px-2 py-3.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="w-6 shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
          {index}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="truncate font-heading text-sm font-medium">
              {title}
            </span>
            <ReportVerdict tone={verdictTone}>{verdict}</ReportVerdict>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-xl font-medium tracking-tight tabular-nums">
              {metric}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground">
              {metricLabel}
            </span>
            {qualifier ? (
              <span className="text-[0.6875rem] text-muted-foreground/80">
                · {qualifier}
              </span>
            ) : null}
          </span>
        </span>

        {visual ? (
          <span className="hidden shrink-0 items-center sm:flex">{visual}</span>
        ) : null}

        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/report-section:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
        <div className="px-2 pt-1 pb-6 sm:pl-12">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Neutral surface for the charts and tables that live inside a section panel. */
export function ReportPanel({
  children,
  className,
  title,
  description,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card/40 p-4", className)}>
      {title ? (
        <div className="mb-3">
          <div className="font-heading text-xs font-medium">{title}</div>
          {description ? (
            <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
