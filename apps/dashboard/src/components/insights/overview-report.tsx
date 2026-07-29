import { useMemo, type ReactNode } from "react";
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
  negotiationShares,
  negotiationVerdict,
  nextSunset,
  releaseAdoptionVerdict,
  reliabilityVerdict,
  resolveCurrentVersion,
  sunsetVerdict,
  versionShareSeries,
} from "./overview-verdicts";

/**
 * Six readings on a versioned API, laid out as cards.
 *
 * The top row is the four that reduce to a single number — those are tiles, so
 * the health of the API is one glance. The three that are inherently
 * shaped (adoption over time and latency against compatibility distance) get
 * their own charts below, because their value is in the shape rather than the
 * summary.
 *
 * Most cards read the daily rollup rather than raw request logs: nine panels
 * against raw rows would be nine concurrent scans of the retention window per
 * page load. The 24-hour traffic curve is the deliberate exception because a
 * daily rollup cannot preserve its hourly shape. Sunset blockers and ingest
 * freshness also stay on raw because they key on dimensions the rollup
 * deliberately does not carry (consumer, sub-day freshness), and each is
 * bounded at the source.
 */

const CURRENT_COLOR = "var(--chart-1)";
const LEGACY_COLOR = "var(--chart-3)";

const latencyChartConfig = {
  p50: { label: "Typical request", color: "var(--chart-3)" },
  p95: { label: "95% complete within", color: "var(--chart-1)" },
} satisfies ChartConfig;

const trafficChartConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
  errorRate: { label: "Error rate", color: "var(--destructive)" },
  avgDepth: { label: "Avg changes bridged", color: "var(--chart-3)" },
} satisfies ChartConfig;

function windowLabel(days: InsightsTimeRangeDays) {
  return days === 1 ? "the last 24 hours" : `the last ${days} days`;
}

function latencyVerdictLabel(verdict: string) {
  switch (verdict) {
    case "Single depth":
      return "Needs comparison";
    case "Scaling":
      return "High overhead";
    case "Climbing":
      return "Added delay";
    case "Flat":
      return "Little overhead";
    default:
      return verdict;
  }
}

export function OverviewReport({
  afterHealth,
  projectId,
  days,
  onVersionClick,
}: {
  afterHealth?: ReactNode;
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
  const freshness = useQuery(ingestFreshnessQueryOptions({ projectId }));
  const releases = useProjectReleases(projectId);

  const totalsData = totals.data;
  const trafficRows = trafficCurve.data ?? [];
  const versionRows = versions.data ?? [];
  const latencyData = latency.data;

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

  // ---- 02 Sunset readiness
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

  // ---- 03 Reliability
  const topLift = lifts[0];
  const reliabilityState =
    totals.isLoading || routeErrors.isLoading
      ? LOADING_VERDICT
      : reliabilityVerdict({
          requests: totalsData?.requests ?? 0,
          errorRate: totalsData?.errorRate ?? 0,
          topLift: topLift?.lift ?? null,
        });

  // ---- 04 Latency
  const latencyState = latency.isLoading
    ? LOADING_VERDICT
    : latencyVerdict({
        requests: latencyData?.overall.requests ?? 0,
        msPerTransform: latencyData?.msPerTransform ?? null,
      });

  // ---- 05 Version negotiation
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

  // ---- 06 Release adoption
  const adoptionState =
    adoption.isLoading || versions.isLoading
      ? LOADING_VERDICT
      : releaseAdoptionVerdict(adoptionTrend);

  // ---- 07 Ingest health
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
            Four readings across {windowLabel(days)}: current-version adoption,
            reliability, latency, and whether clients pin a version explicitly.
          </CardDescription>
          <CardAction>
            <VerdictBadge tone={ingestHealth.tone}>
              Ingest {ingestHealth.verdict}
            </VerdictBadge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                ? `${latencyData.msPerTransform >= 0 ? "+" : ""}${latencyData.msPerTransform.toFixed(1)} ms per API change behind current · typical ${formatMs(latencyData.overall.p50)}`
                : "only one client-version distance in this window"
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

      {afterHealth}

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

      {/* Traffic, errors, and version overhead over time ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Traffic, failures, and version overhead</CardTitle>
          <CardDescription>
            {days === 1 ? "Hourly" : "Daily"} volume with the error rate and the
            average API changes bridged per request. That overhead should fall
            as clients upgrade.
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
                {/* Error rate and compatibility work share an axis only in the
                    sense that both are small numbers; they are read against the
                    request-area shape, not against each other. */}
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
                  callers have migrated while a long tail of smaller ones
                  remains on older versions.
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Latency for older API versions ---------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Latency for older API versions</CardTitle>
          <CardDescription>
            Compares current-version requests with clients pinned further back.
            Each step is one API change the compatibility layer must bridge
            before serving the request.
          </CardDescription>
          <CardAction>
            <VerdictBadge tone={latencyState.tone}>
              {latencyVerdictLabel(latencyState.verdict)}
            </VerdictBadge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {latency.isLoading ? (
            <Skeleton className="h-56 w-full rounded-lg" />
          ) : (latencyData?.byDepth.length ?? 0) < 2 ? (
            <NotRecorded>
              Every request came from clients equally far behind the current
              API, so there is nothing to compare yet.
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
                    tickFormatter={(value: number) =>
                      value === 0 ? "Current" : String(value)
                    }
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
              <p className="pt-2 text-center text-[0.6875rem] text-muted-foreground">
                API changes behind the current version
              </p>
              <FigureRow className="pt-4">
                <Figure
                  label="Typical response"
                  value={formatMs(latencyData?.overall.p50 ?? 0)}
                />
                <Figure
                  label="95% complete within"
                  value={formatMs(latencyData?.overall.p95 ?? 0)}
                />
                <Figure
                  label="99% complete within"
                  value={formatMs(latencyData?.overall.p99 ?? 0)}
                />
                <Figure
                  label="Added per API change"
                  note="estimated from the slowest 5% of requests"
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
            on current — the signature of a broken compatibility rule, and a
            diagnosis no generic APM can make.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {routeErrors.isLoading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : lifts.length === 0 ? (
            <NotRecorded>
              No route fails measurably more on an older version than the same
              route does on current, so nothing here points at version
              compatibility.
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
