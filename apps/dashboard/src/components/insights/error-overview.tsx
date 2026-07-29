import { useQuery } from "@tanstack/react-query";
import { Badge } from "@versionless/ui/components/badge";
import { Button } from "@versionless/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@versionless/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@versionless/ui/components/chart";
import { Skeleton } from "@versionless/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@versionless/ui/components/tooltip";
import {
  ArrowUpRight,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Gauge,
  Repeat2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { DashboardList } from "@/components/dashboard-list";
import { ErrorDetailSheet } from "@/components/insights/error-detail-sheet";
import { TelemetryOfflineState } from "@/components/insights/offline-card";
import type { InsightsTimeRangeDays } from "@/components/insights/time-range-control";
import {
  errorGroupKey,
  parseErrorGroupKey,
  errorOverviewQueryOptions,
  type RecentVersionErrorGroup,
} from "@/queries/errors";

import { relativeTime } from "./format";

const errorChartConfig = {
  errors: { label: "Errors", color: "var(--destructive)" },
} satisfies ChartConfig;

function formatDuration(value: number): string {
  if (value < 1_000) return `${value.toFixed(0)} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

/** Keeps sub-percent rates legible instead of collapsing them to "0%". */
function formatErrorRate(rate: number): string {
  const percent = rate * 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  return `${percent.toFixed(percent < 1 ? 2 : 1)}%`;
}

function Fact({
  children,
  icon,
  label,
}: {
  children: ReactNode;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={label}
            className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground"
          />
        }
      >
        {icon}
        <span className="font-mono tabular-nums">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function RecentErrorList({
  errors,
  isLoading = false,
  navigationKey,
  onErrorClick,
  onVersionClick,
  selectedKey,
}: {
  errors: RecentVersionErrorGroup[];
  isLoading?: boolean;
  navigationKey?: string;
  onErrorClick?: (error: RecentVersionErrorGroup) => void;
  onVersionClick?: (version: string) => void;
  selectedKey?: string;
}) {
  return (
    <TooltipProvider>
      <DashboardList
        className="h-full"
        contentClassName="pr-3"
        emptyState={
          <div>
            <CircleCheck
              aria-hidden="true"
              className="mx-auto mb-2 size-5 text-emerald-600 dark:text-emerald-400"
            />
            <p className="font-medium text-foreground">No errors</p>
            <p className="mt-1">No failed requests in this window.</p>
          </div>
        }
        items={errors}
        getItemAriaLabel={(error) =>
          `Inspect ${error.occurrences} occurrences of ${error.route}`
        }
        getItemKey={errorGroupKey}
        isLoading={isLoading}
        itemClassName="-mx-1 rounded-md px-2 py-3 first:pt-1"
        navigationKey={navigationKey}
        onItemActivate={onErrorClick}
        renderItem={(error) => (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <Button
                className="h-auto shrink-0 gap-1 rounded-md bg-secondary px-2 py-0.5 font-mono text-[0.6875rem] font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={(event) => {
                  event.stopPropagation();
                  onVersionClick?.(error.version);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                variant="ghost"
              >
                {error.version}
                <ArrowUpRight aria-hidden="true" className="size-2.5" />
              </Button>
              <Tooltip>
                <TooltipTrigger
                  render={<span className="min-w-0 flex-1 truncate font-mono" />}
                >
                  {error.route}
                </TooltipTrigger>
                <TooltipContent>{error.route}</TooltipContent>
              </Tooltip>
              <span className="inline-flex shrink-0 items-center gap-1 font-mono font-medium text-destructive tabular-nums">
                <Repeat2 aria-hidden="true" className="size-3.5" />
                {error.occurrences.toLocaleString()}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </div>

            <div className="mt-2 flex min-w-0 items-center gap-3 pl-0.5">
              <Fact
                icon={<Clock3 aria-hidden="true" className="size-3" />}
                label={`Last seen ${relativeTime(error.latestAt)}`}
              >
                {relativeTime(error.latestAt)}
              </Fact>
              <Fact
                icon={<CircleAlert aria-hidden="true" className="size-3" />}
                label={`HTTP status ${error.status >= 400 ? error.status : "error"}`}
              >
                {error.status >= 400 ? error.status : "Error"}
              </Fact>
              <Fact
                icon={<Gauge aria-hidden="true" className="size-3" />}
                label={`Latest request duration ${formatDuration(error.latestDurationMs)}`}
              >
                {formatDuration(error.latestDurationMs)}
              </Fact>
            </div>
          </>
        )}
        scrollAreaClassName="h-full"
        selectedKey={selectedKey}
        skeleton={{ rows: 5, rowHeight: 58 }}
      />
    </TooltipProvider>
  );
}

function ErrorChartSkeleton() {
  return (
    <div className="flex h-56 items-end gap-3 px-3 pb-7 pt-4" role="status">
      {[35, 58, 42, 76, 54, 88, 46].map((height, index) => (
        <Skeleton
          className="min-w-0 flex-1"
          key={`${height}-${index}`}
          style={{ height: `${height}%` }}
        />
      ))}
      <span className="sr-only">Loading error curve</span>
    </div>
  );
}

export function ErrorOverview({
  days,
  onErrorChange,
  onVersionClick,
  projectId,
  selectedErrorKey,
}: {
  days: InsightsTimeRangeDays;
  onErrorChange: (key: string | undefined) => void;
  onVersionClick: (version: string) => void;
  projectId: string;
  selectedErrorKey?: string;
}) {
  const overview = useQuery(
    errorOverviewQueryOptions({ projectId, days, limit: 30 }),
  );
  const totals = overview.data?.totals;
  const totalErrors = totals?.errors ?? 0;
  const error = overview.error;

  if (error) {
    return (
      <Card>
        <CardContent>
          <TelemetryOfflineState error={error} />
        </CardContent>
      </Card>
    );
  }

  const selectedSignature = parseErrorGroupKey(selectedErrorKey);
  const selectedError = selectedSignature
    ? (overview.data?.recent.find(
        (candidate) =>
          candidate.version === selectedSignature.version &&
          candidate.route === selectedSignature.route &&
          candidate.status === selectedSignature.status,
      ) ?? {
        ...selectedSignature,
        latestAt: "",
        latestDurationMs: 0,
        occurrences: 0,
      })
    : null;

  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.8fr)]">
        <Card className="h-80">
          <CardHeader>
            <CardTitle>Error curve</CardTitle>
            <CardDescription>
              Failed requests per {days === 1 ? "hour" : "day"}, from every
              request served.
            </CardDescription>
            <CardAction>
              <Badge variant={totalErrors > 0 ? "destructive" : "secondary"}>
                {totalErrors.toLocaleString()} of{" "}
                {(totals?.requests ?? 0).toLocaleString()}
                {totals && totals.requests > 0
                  ? ` · ${formatErrorRate(totals.errorRate)}`
                  : ""}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            {overview.isLoading ? (
              <ErrorChartSkeleton />
            ) : (overview.data?.curve.length ?? 0) === 0 ? (
              <div className="grid h-56 place-items-center rounded-lg border border-dashed">
                <div className="text-center">
                  <CircleCheck
                    aria-hidden="true"
                    className="mx-auto mb-2 size-5 text-emerald-600 dark:text-emerald-400"
                  />
                  <p className="font-medium">Error-free window</p>
                  <p className="mt-1 text-muted-foreground">
                    Every request in this window succeeded.
                  </p>
                </div>
              </div>
            ) : (
              <ChartContainer
                className="aspect-auto h-full min-h-0 w-full"
                config={errorChartConfig}
              >
                <BarChart
                  data={overview.data?.curve}
                  margin={{ left: -16, right: 12, top: 8 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="bucket"
                    minTickGap={24}
                    tickFormatter={(value: string) =>
                      days === 1 ? value.slice(11, 16) : value.slice(5, 10)
                    }
                    tickLine={false}
                    tickMargin={9}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent indicator="line" />}
                  />
                  <Bar
                    dataKey="errors"
                    fill="var(--color-errors)"
                    maxBarSize={48}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="h-80">
          <CardHeader>
            <CardTitle>Recent errors by version</CardTitle>
            <CardDescription>
              Every failure, grouped by version, route, and status.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden">
            <RecentErrorList
              errors={overview.data?.recent ?? []}
              isLoading={overview.isLoading}
              navigationKey={`recent-errors:${projectId}:${days}`}
              onErrorClick={(error) => onErrorChange(errorGroupKey(error))}
              onVersionClick={onVersionClick}
              selectedKey={selectedErrorKey}
            />
          </CardContent>
        </Card>
      </div>
      <ErrorDetailSheet
        days={days}
        group={selectedError}
        onClose={() => onErrorChange(undefined)}
        onVersionClick={onVersionClick}
        projectId={projectId}
      />
    </>
  );
}
