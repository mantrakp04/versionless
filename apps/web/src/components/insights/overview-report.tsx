import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@versionless/ui/components/chart";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { TableCell } from "@versionless/ui/components/table";
import { ArrowRight } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import { DashboardTable } from "@/components/dashboard-table";
import {
  AdoptionChart,
  AdoptionChartSkeleton,
} from "@/components/insights/adoption-chart";
import {
  isTelemetryOffline,
  OfflineCard,
} from "@/components/insights/offline-card";
import type { InsightsTimeRangeDays } from "@/components/insights/time-range-control";
import { useProjectReleases } from "@/hooks/use-project-releases";
import {
  adoptionQueryOptions,
  sunsetBlockersQueryOptions,
} from "@/queries/insights";
import { latencyOverviewQueryOptions } from "@/queries/latency";
import {
  ingestFreshnessQueryOptions,
  ingestState,
  outreachQueryOptions,
  rankVersionCorrelatedErrors,
  routeVersionErrorsQueryOptions,
} from "@/queries/overview";
import {
  rollupTotalsQueryOptions,
  rollupVersionsQueryOptions,
  trafficCurveQueryOptions,
} from "@/queries/rollup";

import {
  compactNumber,
  formatMs,
  formatPercent,
  plural,
  relativeTime,
} from "./format";
import {
  Figure,
  FigureRow,
  NotRecorded,
  ShareBar,
  StatTile,
  VerdictBadge,
} from "./overview-stats";
import {
  currentTrafficVerdict,
  ingestVerdict,
  latencyVerdict,
  LOADING_VERDICT,
  migrationDebtVerdict,
  negotiationShares,
  negotiationVerdict,
  nextSunset,
  outreachVerdict,
  releaseAdoptionVerdict,
  reliabilityVerdict,
  resolveCurrentVersion,
  sunsetVerdict,
  versionShareSeries,
} from "./overview-verdicts";

/**
 * Nine readings on a versioned API, laid out as cards.
 *
 * The top row is the six that reduce to a single number — those are tiles, so
 * the whole health of the API is one glance. The three that are inherently
 * shaped (adoption over time, latency against transform depth, who is still on
 * an old version) get their own chart or table below, because their value is in
 * the shape rather than the summary.
 *
 * Most cards read the daily rollup rather than raw request logs: nine panels
 * against raw rows would be nine concurrent scans of the retention window per
 * page load. The 24-hour traffic curve is the deliberate exception because a
 * daily rollup cannot preserve its hourly shape. Outreach, sunset blockers,
 * and ingest freshness also stay on raw because they key on dimensions the
 * rollup deliberately does not carry (consumer, sub-day freshness), and each
 * is bounded at the source.
 */

const CURRENT_COLOR = "var(--chart-1)";
const LEGACY_COLOR = "var(--chart-3)";

const latencyChartConfig = {
  p50: { label: "p50", color: "var(--chart-3)" },
  p95: { label: "p95", color: "var(--chart-1)" },
} satisfies ChartConfig;

const trafficChartConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
  errorRate: { label: "Error rate", color: "var(--destructive)" },
  avgDepth: { label: "Avg depth", color: "var(--chart-3)" },
} satisfies ChartConfig;

const OUTREACH_GRID_COLUMNS =
  "minmax(10rem, 1.6fr) minmax(7rem, 1fr) repeat(3, minmax(4.5rem, .6fr))";

function windowLabel(days: InsightsTimeRangeDays) {
  return days === 1 ? "the last 24 hours" : `the last ${days} days`;
}

export function OverviewReport({
  projectId,
  days,
  onVersionClick,
}: {
  projectId: string;
  days: InsightsTimeRangeDays;
  onVersionClick: (version: string) => void;
}) {
  const totals = useQuery(rollupTotalsQueryOptions({ projectId, days }));
  const trafficCurve = useQuery(trafficCurveQueryOptions({ projectId, days }));
  const versions = useQuery(rollupVersionsQueryOptions({ projectId, days }));
  const latency = useQuery(latencyOverviewQueryOptions({ projectId, days }));
  const adoption = useQuery(adoptionQueryOptions(projectId, days));
  const routeErrors = useQuery(
    routeVersionErrorsQueryOptions({ projectId, days }),
  );
  const outreach = useQuery(outreachQueryOptions({ projectId, days }));
  const freshness = useQuery(ingestFreshnessQueryOptions({ projectId }));
  const releases = useProjectReleases(projectId);

  const totalsData = totals.data;
  const trafficRows = trafficCurve.data ?? [];
  const versionRows = versions.data ?? [];
  const latencyData = latency.data;
  const outreachRows = outreach.data ?? [];

  const today = useMemo(() => new Date(), []);
  const current = useMemo(
    () =>
      resolveCurrentVersion(
        releases.current,
        versionRows.map((row) => row.version),
      ),
    [releases.current, versionRows],
  );
  const sunset = useMemo(
    () => nextSunset(releases.sunsets, today),
    [releases.sunsets, today],
  );
  const lifts = useMemo(
    () => rankVersionCorrelatedErrors(routeErrors.data ?? [], current.version),
    [current.version, routeErrors.data],
  );
  const adoptionTrend = useMemo(
    () => versionShareSeries(adoption.data ?? [], current.version ?? ""),
    [adoption.data, current.version],
  );
  const trafficSeries = useMemo(
    () =>
      trafficRows.map((row) => ({
        bucket: days === 1 ? row.day.slice(11, 16) : row.day.slice(5),
        requests: row.requests,
        errorRate: row.errorRate * 100,
        avgDepth: row.avgDepth,
      })),
    [days, trafficRows],
  );

  // Blockers only mean something once a version is known to be retiring, and
  // the query is a raw scan, so it stays disabled until then.
  const blockers = useQuery({
    ...sunsetBlockersQueryOptions({
      projectId,
      version: sunset?.version ?? "",
      sort: "requests",
      direction: "desc",
    }),
    enabled: sunset !== null,
  });

  const telemetryError = [
    totals.error,
    trafficCurve.error,
    versions.error,
    latency.error,
    adoption.error,
    routeErrors.error,
    outreach.error,
    freshness.error,
  ].find(isTelemetryOffline);
  if (telemetryError) return <OfflineCard error={telemetryError} />;

  const currentRow = current.version
    ? versionRows.find((row) => row.version === current.version)
    : undefined;

  // ---- 01 Traffic on current
  const requestShare =
    totalsData && totalsData.requests > 0
      ? (currentRow?.requests ?? 0) / totalsData.requests
      : 0;
  const consumerShare =
    totalsData && totalsData.consumers > 0
      ? (currentRow?.consumers ?? 0) / totalsData.consumers
      : 0;
  const trafficState =
    totals.isLoading || versions.isLoading
      ? LOADING_VERDICT
      : currentTrafficVerdict({
          requests: totalsData?.requests ?? 0,
          requestShare,
          consumerShare,
        });

  // ---- 02 Migration debt
  const debtState =
    totals.isLoading || trafficCurve.isLoading
      ? LOADING_VERDICT
      : migrationDebtVerdict({
          avgDepth: totalsData?.avgDepth ?? 0,
          dailyDepth: trafficRows.map((row) => row.avgDepth),
        });

  // ---- 03 Sunset readiness
  const blockerRows = blockers.data ?? [];
  const blockingConsumers = new Set(blockerRows.map((row) => row.consumerKey))
    .size;
  const blockedRoutes = new Set(blockerRows.map((row) => row.route)).size;
  const sunsetState = releases.isLoading
    ? LOADING_VERDICT
    : sunsetVerdict({
        sunset,
        blockingConsumers,
        declared: releases.declared,
      });

  // ---- 04 Reliability
  const topLift = lifts[0];
  const reliabilityState =
    totals.isLoading || routeErrors.isLoading
      ? LOADING_VERDICT
      : reliabilityVerdict({
          requests: totalsData?.requests ?? 0,
          errorRate: totalsData?.errorRate ?? 0,
          topLift: topLift?.lift ?? null,
        });

  // ---- 05 Latency
  const latencyState = latency.isLoading
    ? LOADING_VERDICT
    : latencyVerdict({
        requests: latencyData?.overall.requests ?? 0,
        msPerTransform: latencyData?.msPerTransform ?? null,
      });

  // ---- 06 Version negotiation
  const shares = negotiationShares(
    totalsData ?? {
      requests: 0,
      sourced: 0,
      unpinned: 0,
      clamped: 0,
      negotiated: 0,
    },
  );
  const negotiationState = totals.isLoading
    ? LOADING_VERDICT
    : negotiationVerdict(shares);

  // ---- 07 Outreach
  const offCurrent = current.version
    ? outreachRows.filter((row) => row.version !== current.version)
    : [];
  const outreachState = outreach.isLoading
    ? LOADING_VERDICT
    : outreachVerdict({
        consumers: outreachRows.length,
        offCurrent: offCurrent.length,
      });

  // ---- 08 Release adoption
  const adoptionState =
    adoption.isLoading || versions.isLoading
      ? LOADING_VERDICT
      : releaseAdoptionVerdict(adoptionTrend);

  // ---- 09 Ingest health
  const ingest = freshness.data
    ? ingestState(freshness.data, today)
    : { state: "silent" as const, minutesSince: null };
  const ingestHealth = freshness.isLoading
    ? LOADING_VERDICT
    : ingestVerdict(ingest.state);

  const legacyRequests = Math.max(
    (totalsData?.requests ?? 0) - (currentRow?.requests ?? 0),
    0,
  );

  return (
    <>
      {/* Headline tiles ------------------------------------------------- */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>API health</CardTitle>
          <CardDescription>
            Six readings across {windowLabel(days)}: how much traffic still runs
            on old versions, what that legacy costs, and whether anything is
            breaking because of it.
          </CardDescription>
          <CardAction>
            <VerdictBadge tone={ingestHealth.tone}>
              Ingest {ingestHealth.verdict}
            </VerdictBadge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            hint={
              current.version
                ? `${formatPercent(consumerShare)} of consumers · ${current.version}`
                : "no version has served a request"
            }
            isLoading={totals.isLoading || versions.isLoading}
            label="Traffic on current"
            tone={trafficState.tone}
            value={formatPercent(requestShare)}
            verdict={trafficState.verdict}
            visual={
              <ShareBar
                className="pt-1.5"
                segments={[
                  {
                    label: "Current",
                    value: currentRow?.requests ?? 0,
                    color: CURRENT_COLOR,
                  },
                  { label: "Legacy", value: legacyRequests, color: LEGACY_COLOR },
                ]}
              />
            }
          />

          <StatTile
            hint={`${compactNumber(
              Math.round(
                (totalsData?.requests ?? 0) * (totalsData?.avgDepth ?? 0),
              ),
            )} transforms run · peak depth ${totalsData?.maxDepth ?? 0}`}
            isLoading={totals.isLoading || trafficCurve.isLoading}
            label="Migration debt"
            tone={debtState.tone}
            value={`${(totalsData?.avgDepth ?? 0).toFixed(2)}`}
            verdict={debtState.verdict}
          />

          <StatTile
            hint={
              sunset
                ? `${sunset.version} · ${
                    blockers.isLoading
                      ? "counting blockers"
                      : `${blockingConsumers}${
                          blockerRows.length >= 200 ? "+" : ""
                        } ${plural(blockingConsumers, "consumer")} on ${blockedRoutes} ${plural(blockedRoutes, "route")}`
                  }`
                : releases.declared
                  ? "no sunset scheduled"
                  : "no contract snapshot uploaded"
            }
            isLoading={releases.isLoading}
            label="Next sunset"
            tone={sunsetState.tone}
            value={
              sunset
                ? sunset.daysAway >= 0
                  ? `${sunset.daysAway}d`
                  : "Overdue"
                : "None"
            }
            verdict={sunsetState.verdict}
          />

          <StatTile
            hint={`${compactNumber(totalsData?.errors ?? 0)} of ${compactNumber(
              totalsData?.requests ?? 0,
            )} requests failed`}
            isLoading={totals.isLoading || routeErrors.isLoading}
            label="Error rate"
            tone={reliabilityState.tone}
            value={formatPercent(totalsData?.errorRate ?? 0)}
            verdict={reliabilityState.verdict}
          />

          <StatTile
            hint={
              latencyData?.msPerTransform != null
                ? `${latencyData.msPerTransform >= 0 ? "+" : ""}${latencyData.msPerTransform.toFixed(1)} ms per transform · p50 ${formatMs(latencyData.overall.p50)}`
                : "only one transform depth in this window"
            }
            isLoading={latency.isLoading}
            label="p95 latency"
            tone={latencyState.tone}
            value={formatMs(latencyData?.overall.p95 ?? 0)}
            verdict={latencyState.verdict}
          />

          <StatTile
            hint={
              shares.recorded
                ? `${formatPercent(shares.clampedShare)} pinned ahead of current · ${formatPercent(shares.negotiatedShare)} negotiated`
                : "version source not recorded by this SDK"
            }
            isLoading={totals.isLoading}
            label="Unpinned traffic"
            tone={negotiationState.tone}
            value={shares.recorded ? formatPercent(shares.unpinnedShare) : "n/a"}
            verdict={negotiationState.verdict}
            visual={
              shares.recorded ? (
                <ShareBar
                  className="pt-1.5"
                  segments={[
                    {
                      label: "Pinned",
                      value: Math.max(
                        (totalsData?.sourced ?? 0) - (totalsData?.unpinned ?? 0),
                        0,
                      ),
                      color: CURRENT_COLOR,
                    },
                    {
                      label: "Unpinned",
                      value: totalsData?.unpinned ?? 0,
                      color: LEGACY_COLOR,
                    },
                  ]}
                />
              ) : undefined
            }
          />
        </CardContent>
      </Card>

      {/* Traffic, errors, and depth over time ---------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Traffic, failures, and transform depth</CardTitle>
          <CardDescription>
            {days === 1 ? "Hourly" : "Daily"} volume with the error rate and
            average transform depth over it. Depth should fall after a migration
            campaign — flat or rising means versions are accumulating rather
            than retiring.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trafficCurve.isLoading ? (
            <Skeleton className="h-56 w-full rounded-lg" />
          ) : trafficSeries.length === 0 ? (
            <NotRecorded>
              No request has been served in this window, so there is nothing to
              plot yet.
            </NotRecorded>
          ) : (
            <ChartContainer
              className="aspect-auto h-56 w-full"
              config={trafficChartConfig}
            >
              <AreaChart
                data={trafficSeries}
                margin={{ left: 4, right: 8, top: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="bucket"
                  minTickGap={24}
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  axisLine={false}
                  tickFormatter={compactNumber}
                  tickLine={false}
                  width={44}
                  yAxisId="requests"
                />
                {/* Error rate and depth share an axis only in the sense that
                    both are small numbers; they are read against the shape of
                    the request area, not against each other. */}
                <YAxis
                  axisLine={false}
                  orientation="right"
                  tickLine={false}
                  width={36}
                  yAxisId="rate"
                />
                <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                <Area
                  dataKey="requests"
                  fill="var(--color-requests)"
                  fillOpacity={0.15}
                  stroke="var(--color-requests)"
                  strokeWidth={2}
                  type="monotone"
                  yAxisId="requests"
                />
                <Line
                  dataKey="errorRate"
                  dot={false}
                  stroke="var(--color-errorRate)"
                  strokeWidth={2}
                  type="monotone"
                  yAxisId="rate"
                />
                <Line
                  dataKey="avgDepth"
                  dot={false}
                  stroke="var(--color-avgDepth)"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                  type="monotone"
                  yAxisId="rate"
                />
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Version split --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Where traffic sits</CardTitle>
          <CardDescription>
            Requests by version, with the consumers behind each. Request share
            and consumer share diverge when one large caller migrates and a long
            tail does not.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versions.isLoading ? (
            <Skeleton className="h-48 w-full rounded-lg" />
          ) : versionRows.length === 0 ? (
            <NotRecorded>
              No version carried traffic in this window.
            </NotRecorded>
          ) : (
            <div className="space-y-3">
              {versionRows.slice(0, 8).map((row) => {
                const isCurrent = row.version === current.version;
                const share =
                  row.requests / Math.max(totalsData?.requests ?? 1, 1);
                return (
                  <button
                    className="w-full rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/50"
                    key={row.version}
                    onClick={() => onVersionClick(row.version)}
                    type="button"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-4 text-xs">
                      <span className="min-w-0 truncate font-mono">
                        {row.version}
                        {isCurrent ? (
                          <span className="ml-2 text-[0.6875rem] text-muted-foreground">
                            current
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                        {formatPercent(share)} · {compactNumber(row.requests)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            backgroundColor: isCurrent
                              ? CURRENT_COLOR
                              : LEGACY_COLOR,
                            width: `${Math.max(share * 100, 2)}%`,
                          }}
                        />
                      </span>
                      <span className="w-28 shrink-0 text-right text-[0.6875rem] text-muted-foreground tabular-nums">
                        {compactNumber(row.consumers)}{" "}
                        {plural(row.consumers, "consumer")}
                      </span>
                    </div>
                  </button>
                );
              })}
              {requestShare - consumerShare >= 0.2 ? (
                <p className="pt-1 text-[0.6875rem] text-muted-foreground">
                  Request share runs well ahead of consumer share: the large
                  callers have migrated and a long tail of smaller ones has not.
                  The outreach list below is that tail, by name.
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Adoption curve -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Adoption curve</CardTitle>
          <CardDescription>
            Requests per {days === 1 ? "hour" : "day"}, stacked by the version
            each client pinned.
          </CardDescription>
          <CardAction>
            <VerdictBadge tone={adoptionState.tone}>
              {adoptionState.verdict}
            </VerdictBadge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {adoption.isLoading ? (
            <AdoptionChartSkeleton />
          ) : (
            <>
              <AdoptionChart hourly={days === 1} rows={adoption.data ?? []} />
              {current.version ? (
                <p className="pt-3 text-[0.6875rem] text-muted-foreground">
                  <span className="font-mono">{current.version}</span> holds{" "}
                  {formatPercent(adoptionTrend.recentShare)} of recent traffic,
                  against {formatPercent(adoptionTrend.priorShare)} at the start
                  of the window.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Latency by transform depth -------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Latency by transform depth</CardTitle>
          <CardDescription>
            Latency at each transform depth. A p95 that climbs with depth turns
            a migration nag into a performance argument your customers can act
            on.
          </CardDescription>
          <CardAction>
            <VerdictBadge tone={latencyState.tone}>
              {latencyState.verdict}
            </VerdictBadge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {latency.isLoading ? (
            <Skeleton className="h-56 w-full rounded-lg" />
          ) : (latencyData?.byDepth.length ?? 0) < 2 ? (
            <NotRecorded>
              Every request in this window ran the same number of transforms, so
              there is no depth-to-latency relationship to fit yet.
            </NotRecorded>
          ) : (
            <>
              <ChartContainer
                className="aspect-auto h-56 w-full"
                config={latencyChartConfig}
              >
                <BarChart
                  data={latencyData?.byDepth ?? []}
                  margin={{ left: 0, right: 12, top: 8 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="depth"
                    tickLine={false}
                    tickMargin={8}
                  />
                  <YAxis axisLine={false} tickLine={false} width={44} />
                  <ChartTooltip
                    content={<ChartTooltipContent indicator="dot" />}
                  />
                  <Bar
                    dataKey="p50"
                    fill="var(--color-p50)"
                    maxBarSize={36}
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="p95"
                    fill="var(--color-p95)"
                    maxBarSize={36}
                    radius={[3, 3, 0, 0]}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </BarChart>
              </ChartContainer>
              <FigureRow className="pt-4">
                <Figure
                  label="p50"
                  value={formatMs(latencyData?.overall.p50 ?? 0)}
                />
                <Figure
                  label="p95"
                  value={formatMs(latencyData?.overall.p95 ?? 0)}
                />
                <Figure
                  label="p99"
                  value={formatMs(latencyData?.overall.p99 ?? 0)}
                />
                <Figure
                  label="Cost per transform"
                  note="request-weighted fit of p95 across depths"
                  value={
                    latencyData?.msPerTransform != null
                      ? `${latencyData.msPerTransform.toFixed(1)} ms`
                      : "n/a"
                  }
                />
              </FigureRow>
            </>
          )}
        </CardContent>
      </Card>

      {/* Version-correlated failures ------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Version-correlated failures</CardTitle>
          <CardDescription>
            Routes that fail more on an older version than the same route does
            on current — the signature of a broken down transform, and a
            diagnosis no generic APM can make.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {routeErrors.isLoading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : lifts.length === 0 ? (
            <NotRecorded>
              No route fails measurably more on an older version than the same
              route does on current, so nothing here points at a transform chain.
            </NotRecorded>
          ) : (
            <div className="divide-y">
              {lifts.map((row) => (
                <button
                  className="flex w-full items-center justify-between gap-4 py-2.5 text-left transition-colors first:pt-0 hover:bg-muted/50"
                  key={`${row.version}:${row.route}`}
                  onClick={() => onVersionClick(row.version)}
                  type="button"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">{row.route}</div>
                    <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                      <span className="font-mono">{row.version}</span> fails at{" "}
                      {formatPercent(row.errorRate)} vs{" "}
                      {formatPercent(row.baselineRate)} on current
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-xs font-medium text-destructive tabular-nums">
                      {Number.isFinite(row.lift)
                        ? `${row.lift.toFixed(1)}×`
                        : "only here"}
                    </div>
                    <div className="text-[0.6875rem] text-muted-foreground tabular-nums">
                      {compactNumber(row.errors)} {plural(row.errors, "failure")}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Outreach list --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Migration outreach list</CardTitle>
          <CardDescription>
            Busiest callers with the version they pin now, what their calls cost
            in transforms, and when they last called. Keys are opaque
            fingerprints — the raw API key never leaves the SDK.
          </CardDescription>
          <CardAction>
            <VerdictBadge tone={outreachState.tone}>
              {outreachState.verdict}
            </VerdictBadge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <DashboardTable
            emptyState="No consumer called in this window."
            errorState="The outreach list is temporarily unavailable."
            getItemKey={(row) => row.consumerKey}
            gridTemplateColumns={OUTREACH_GRID_COLUMNS}
            isError={outreach.isError}
            isLoading={outreach.isLoading}
            items={outreachRows.slice(0, 12)}
            navigationKey={`overview-outreach:${projectId}:${days}`}
            onRowActivate={(row) => onVersionClick(row.version)}
            renderHeader={() => (
              <>
                <TableCell className="text-muted-foreground">Consumer</TableCell>
                <TableCell className="text-muted-foreground">Version</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  Requests
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  Depth
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  Last seen
                </TableCell>
              </>
            )}
            renderRow={(row) => (
              <>
                <TableCell className="truncate font-mono">
                  {row.consumerKey}
                </TableCell>
                <TableCell className="font-mono">
                  {row.version}
                  {current.version && row.version !== current.version ? (
                    <span className="ml-1.5 text-[0.6875rem] text-amber-600 dark:text-amber-400">
                      off current
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {compactNumber(row.requests)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.avgDepth.toFixed(1)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {relativeTime(row.lastSeen)}
                </TableCell>
              </>
            )}
          />
        </CardContent>
      </Card>

      {/* Sunset readiness ------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Sunset readiness</CardTitle>
          <CardDescription>
            {sunset
              ? `Everything on ${sunset.version} and below stops being served after ${sunset.after}.`
              : "Retirement countdown for the oldest live version."}
          </CardDescription>
          {sunset ? (
            <CardAction>
              <Button
                nativeButton={false}
                render={
                  <Link
                    params={{ projectId }}
                    search={{ days }}
                    to="/insights/$projectId/sunset"
                  />
                }
                size="sm"
                variant="ghost"
              >
                See who is blocking
                <ArrowRight aria-hidden="true" />
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {releases.isLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : !releases.declared ? (
            <NotRecorded>
              This project has not uploaded a contract snapshot, so we do not
              know which versions it declares or when they retire. Run{" "}
              <code className="font-mono">versionless snapshot</code> in CI to
              publish the version chain and its sunsets.
            </NotRecorded>
          ) : !sunset ? (
            <NotRecorded>
              No sunset is scheduled. Declare one with{" "}
              <code className="font-mono">v.sunset()</code> to start a retirement
              countdown and see who is blocking it.
            </NotRecorded>
          ) : (
            <div className="space-y-4">
              <FigureRow>
                <Figure
                  label="Retiring"
                  note={`after ${sunset.after}`}
                  value={sunset.version}
                />
                <Figure
                  label="Days left"
                  note={sunset.daysAway < 0 ? "past its cutoff" : undefined}
                  tone={sunsetState.tone}
                  value={
                    sunset.daysAway >= 0 ? `${sunset.daysAway}d` : "Overdue"
                  }
                />
                <Figure
                  label="Blocking consumers"
                  note={
                    blockerRows.length >= 200
                      ? "at least — the blocker list is capped at 200 rows"
                      : "still calling on or below the sunset version"
                  }
                  value={blockers.isLoading ? "—" : String(blockingConsumers)}
                />
                <Figure
                  label="Affected routes"
                  note="endpoints those consumers still reach"
                  value={blockers.isLoading ? "—" : String(blockedRoutes)}
                />
              </FigureRow>
              {sunset.message ? (
                <p className="text-[0.6875rem] text-muted-foreground">
                  {sunset.message}
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ingest health --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Telemetry ingest</CardTitle>
          <CardDescription>
            A dashboard that silently shows a flat line because ingest broke is
            worse than one that shows an error.
          </CardDescription>
          <CardAction>
            <VerdictBadge tone={ingestHealth.tone}>
              {ingestHealth.verdict}
            </VerdictBadge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {freshness.isLoading ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : (
            <div className="space-y-4">
              <FigureRow>
                <Figure
                  label="Last request"
                  note={
                    freshness.data?.lastEventAt
                      ? relativeTime(freshness.data.lastEventAt)
                      : "no request log in the last two hours"
                  }
                  tone={ingestHealth.tone}
                  value={
                    ingest.minutesSince === null
                      ? "—"
                      : `${ingest.minutesSince} min ago`
                  }
                />
                <Figure
                  label="Last hour"
                  value={compactNumber(freshness.data?.lastHour ?? 0)}
                />
                <Figure
                  label="Hour before"
                  value={compactNumber(freshness.data?.priorHour ?? 0)}
                />
              </FigureRow>
              <p className="text-[0.6875rem] text-muted-foreground">
                {ingest.state === "live"
                  ? "Telemetry is arriving now, so every number above is current."
                  : ingest.state === "quiet"
                    ? "Nothing recently, but nothing suggesting a broken pipeline either — a quiet API looks the same as a stopped one until traffic resumes."
                    : ingest.state === "stale"
                      ? "Traffic stopped arriving without tapering off. Check that the exporter and the OTLP gateway are still reachable before trusting the figures above."
                      : "No request logs have arrived at all. Confirm the SDK is initialised and its telemetry key is set."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
