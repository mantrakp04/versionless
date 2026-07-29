import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@versionless/ui/components/button";
import { Card, CardContent } from "@versionless/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@versionless/ui/components/chart";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { ArrowRight, RadioTower } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { DashboardList } from "@/components/dashboard-list";
import {
  isTelemetryOffline,
  TelemetryOfflineState,
} from "@/components/insights/offline-card";
import type { InsightsTimeRangeDays } from "@/components/insights/time-range-control";
import {
  adoptionQueryOptions,
  versionRouteAnalyticsQueryOptions,
  versionsQueryOptions,
  type AdoptionPoint,
  type VersionRouteAnalytics,
} from "@/queries/insights";
import { traceListQueryOptions, type TraceSummary } from "@/queries/traces";

import { compactNumber, plural, relativeTime } from "./format";
import {
  ReportGroupHeading,
  ReportPanel,
  ReportSection,
  type StatTone,
} from "./report-section";
import { MiniBars, Sparkline } from "./report-visuals";

/** Sections this component renders, so the full report can keep numbering. */
export const RUNTIME_SECTION_COUNT = 2;

const trafficChartConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function versionTrafficSeries(rows: AdoptionPoint[], version: string) {
  return rows
    .filter((row) => row.version === version)
    .map((row) => ({ bucket: row.bucket, requests: row.requests }));
}

function windowLabel(days: InsightsTimeRangeDays) {
  return days === 1 ? "24 hours" : `${days} days`;
}

interface SectionVerdict {
  verdict: string;
  tone: StatTone;
}

/** How much of the project still leans on this version. */
export function trafficVerdict({
  requests,
  share,
}: {
  requests: number;
  share: number;
}): SectionVerdict {
  if (requests === 0) return { verdict: "Idle", tone: "muted" };
  if (share >= 50) return { verdict: "Primary", tone: "positive" };
  if (share >= 10) return { verdict: "Active", tone: "neutral" };
  return { verdict: "Trailing", tone: "negative" };
}

/** Whether load sits on one route or spreads across the surface. */
export function routeVerdict(routes: VersionRouteAnalytics[]): SectionVerdict {
  if (routes.length === 0) return { verdict: "No traffic", tone: "muted" };
  const total = routes.reduce((sum, route) => sum + route.requests, 0);
  const busiest = Math.max(...routes.map((route) => route.requests));
  return Math.round((busiest / Math.max(total, 1)) * 100) >= 60
    ? { verdict: "Concentrated", tone: "neutral" }
    : { verdict: "Spread", tone: "neutral" };
}

/** Trailing qualifier for the routes row: compatibility work per request. */
export function depthQualifier(routes: VersionRouteAnalytics[], depth: number) {
  if (routes.length === 0) return undefined;
  return depth < 0.05
    ? "no API changes bridged"
    : `${depth.toFixed(1)} API changes bridged per request`;
}

function TrafficChart({
  points,
  hourly,
}: {
  points: ReturnType<typeof versionTrafficSeries>;
  hourly: boolean;
}) {
  if (points.length === 0) {
    return (
      <div className="grid h-56 place-items-center rounded-lg border border-dashed">
        <div className="text-center">
          <RadioTower
            aria-hidden="true"
            className="mx-auto mb-2 size-5 text-muted-foreground/60"
          />
          <p className="font-medium">No requests in this window</p>
          <p className="mt-1 text-muted-foreground">
            The API definition is ready; live traffic has not arrived yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ChartContainer
      config={trafficChartConfig}
      className="aspect-auto h-56 w-full"
    >
      <AreaChart data={points} margin={{ left: -16, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="versionTrafficFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-requests)"
              stopOpacity={0.32}
            />
            <stop
              offset="95%"
              stopColor="var(--color-requests)"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="bucket"
          minTickGap={28}
          tickFormatter={(value: string) =>
            hourly ? value.slice(11, 16) : value.slice(5, 10)
          }
          tickLine={false}
          tickMargin={9}
        />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="requests"
          fill="url(#versionTrafficFill)"
          stroke="var(--color-requests)"
          strokeWidth={2.25}
          type="monotone"
        />
      </AreaChart>
    </ChartContainer>
  );
}

function RouteWorkload({ routes }: { routes: VersionRouteAnalytics[] }) {
  const visible = routes.slice(0, 8);
  const maxRequests = Math.max(...visible.map((route) => route.requests), 1);

  return (
    <ReportPanel
      description={
        routes.length > visible.length
          ? `Top ${visible.length} of ${routes.length} routes by request volume, with the average API changes bridged.`
          : "Busiest routes, paired with the average API changes bridged."
      }
      title="Where the work happens"
    >
      <DashboardList
        contentClassName="space-y-4 divide-y-0"
        emptyState="No route activity in this window."
        getItemKey={(route) => route.route}
        itemClassName="py-0"
        items={visible}
        renderItem={(route) => (
          <>
            <div className="mb-1.5 flex items-center justify-between gap-4">
              <span className="min-w-0 truncate font-mono">
                {route.route || "unknown route"}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                {compactNumber(route.requests)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[var(--chart-1)]"
                  style={{
                    width: `${Math.max((route.requests / maxRequests) * 100, 3)}%`,
                  }}
                />
              </div>
              <span className="w-16 text-right text-[0.6875rem] text-muted-foreground">
                {route.avgDepth.toFixed(1)} changes
              </span>
            </div>
          </>
        )}
      />
    </ReportPanel>
  );
}

function RecentTraces({
  traces,
  projectId,
  days,
}: {
  traces: TraceSummary[];
  projectId: string;
  days: InsightsTimeRangeDays;
}) {
  return (
    <ReportPanel
      description="A quick read on latency and failures for this version."
      title="Recent request traces"
    >
      <DashboardList
        emptyState="No sampled traces for this version."
        getItemKey={(trace) => trace.traceId}
        itemClassName="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0"
        items={traces.slice(0, 5)}
        renderItem={(trace) => (
          <>
            <div className="min-w-0">
              <div className="truncate font-mono">
                {trace.route || "unknown route"}
              </div>
              <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                {relativeTime(trace.ts)} · {trace.spanCount} spans
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono tabular-nums">
                {trace.durationMs.toFixed(1)} ms
              </div>
              <div
                className={
                  trace.hasError
                    ? "text-[0.6875rem] text-red-600 dark:text-red-400"
                    : "text-[0.6875rem] text-emerald-700 dark:text-emerald-400"
                }
              >
                {trace.hasError ? "Error" : trace.status || "OK"}
              </div>
            </div>
          </>
        )}
      />
      <Button
        className="mt-3 self-start"
        nativeButton={false}
        render={
          <Link
            to="/insights/$projectId/traces"
            params={{ projectId }}
            search={{ days }}
          />
        }
        size="sm"
        variant="ghost"
      >
        Explore traces
        <ArrowRight aria-hidden="true" />
      </Button>
    </ReportPanel>
  );
}

export function VersionRuntimeAnalytics({
  projectId,
  version,
  days,
}: {
  projectId: string;
  version: string;
  days: InsightsTimeRangeDays;
}) {
  const adoption = useQuery(adoptionQueryOptions(projectId, days));
  const summaries = useQuery(versionsQueryOptions(projectId, days));
  const routes = useQuery(
    versionRouteAnalyticsQueryOptions({ projectId, version, days }),
  );
  const traces = useQuery(
    traceListQueryOptions({
      projectId,
      version,
      hours: days * 24,
      errorsOnly: false,
      sort: "time",
      direction: "desc",
      limit: 5,
    }),
  );

  const traffic = useMemo(
    () => versionTrafficSeries(adoption.data ?? [], version),
    [adoption.data, version],
  );
  const summary = summaries.data?.find((item) => item.version === version);
  const totalRequests =
    summaries.data?.reduce((total, item) => total + item.requests, 0) ?? 0;
  const share =
    summary && totalRequests > 0
      ? Math.round((summary.requests / totalRequests) * 100)
      : 0;
  const routeRows = routes.data ?? [];
  const weightedDepth =
    routeRows.reduce(
      (total, route) => total + route.avgDepth * route.requests,
      0,
    ) /
    Math.max(
      routeRows.reduce((total, route) => total + route.requests, 0),
      1,
    );

  const trafficState = trafficVerdict({
    requests: summary?.requests ?? 0,
    share,
  });
  const routeState = routeVerdict(routeRows);

  const telemetryError = [
    adoption.error,
    summaries.error,
    routes.error,
    traces.error,
  ].find(isTelemetryOffline);

  const loading =
    adoption.isLoading ||
    summaries.isLoading ||
    routes.isLoading ||
    traces.isLoading;

  if (telemetryError) {
    return (
      <>
        <ReportGroupHeading>Live usage</ReportGroupHeading>
        <Card>
          <CardContent>
            <TelemetryOfflineState error={telemetryError} />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <ReportGroupHeading>
        Live usage · last {windowLabel(days)}
      </ReportGroupHeading>

      <ReportSection
        id="traffic"
        index="01"
        metric={loading ? "—" : compactNumber(summary?.requests ?? 0)}
        metricLabel={loading ? "reading telemetry" : "requests"}
        qualifier={
          loading
            ? undefined
            : `${compactNumber(summary?.clients ?? 0)} ${plural(
                summary?.clients ?? 0,
                "consumer",
              )} · ${share}% of traffic`
        }
        title="Who is still calling this version"
        verdict={loading ? "Loading" : trafficState.verdict}
        verdictTone={loading ? "muted" : trafficState.tone}
        visual={
          loading ? undefined : (
            <Sparkline values={traffic.map((point) => point.requests)} />
          )
        }
      >
        {loading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(17rem,0.8fr)]">
            <ReportPanel
              description={`Traffic pinned to ${version}, per ${days === 1 ? "hour" : "day"}.`}
              title="Request volume"
            >
              <TrafficChart points={traffic} hourly={days === 1} />
            </ReportPanel>
            <RecentTraces
              days={days}
              projectId={projectId}
              traces={traces.data ?? []}
            />
          </div>
        )}
      </ReportSection>

      <ReportSection
        id="routes"
        index="02"
        metric={loading ? "—" : routeRows.length}
        metricLabel={loading ? "reading telemetry" : "active routes"}
        qualifier={
          loading ? undefined : depthQualifier(routeRows, weightedDepth)
        }
        title="Where the traffic lands"
        verdict={loading ? "Loading" : routeState.verdict}
        verdictTone={loading ? "muted" : routeState.tone}
        visual={
          loading ? undefined : (
            <MiniBars values={routeRows.map((route) => route.requests)} />
          )
        }
      >
        {loading ? (
          <Skeleton className="h-56 w-full rounded-lg" />
        ) : (
          <RouteWorkload routes={routeRows} />
        )}
      </ReportSection>
    </>
  );
}
