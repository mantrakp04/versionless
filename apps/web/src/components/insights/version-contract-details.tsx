import type {
  ProjectVersionDetail,
  ProjectVersionEndpointDetail,
} from "@versionless/api/routers/projects";
import { useMemo, useState, type ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@versionless/ui/components/accordion";
import { Badge } from "@versionless/ui/components/badge";
import { Button } from "@versionless/ui/components/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@versionless/ui/components/chart";
import { Input } from "@versionless/ui/components/input";
import { Separator } from "@versionless/ui/components/separator";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleMinus,
  GitBranch,
  Minus,
} from "lucide-react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { compactNumber, plural, relativeTime } from "./format";
import {
  Report,
  ReportControls,
  ReportGroupHeading,
  ReportHeadlineStat,
  ReportLead,
  ReportPanel,
  ReportSection,
  type StatTone,
} from "./report-section";
import { Sparkline, SplitBar } from "./report-visuals";

const chartConfig = {
  endpoints: { label: "Endpoints", color: "var(--chart-1)" },
  models: { label: "Models", color: "var(--chart-2)" },
  procedures: { label: "RPC procedures", color: "var(--chart-3)" },
} satisfies ChartConfig;

type MetricKey =
  "endpointCount" | "modelCount" | "schemaFieldCount" | "procedureCount";

function byVersionAscending(
  left: ProjectVersionDetail,
  right: ProjectVersionDetail,
) {
  return left.version.localeCompare(right.version);
}

export function buildVersionTrend(versions: ProjectVersionDetail[]) {
  return versions.toSorted(byVersionAscending).map((version) => ({
    version: version.version,
    endpoints: version.endpointCount,
    models: version.modelCount,
    procedures: version.procedureCount,
  }));
}

function metricHistory(versions: ProjectVersionDetail[], key: MetricKey) {
  return versions.toSorted(byVersionAscending).map((version) => version[key]);
}

function signed(delta: number) {
  return `${delta > 0 ? "+" : ""}${delta}`;
}

/** One sentence for the top of the sheet; the numbers live in the stat strip. */
export function buildContractHeadline(
  detail: ProjectVersionDetail,
  versions: ProjectVersionDetail[],
  previous?: ProjectVersionDetail,
): string {
  if (!previous) {
    return versions.length > 1
      ? `${detail.version} is the oldest contract on file.`
      : `${detail.version} is the only contract on file.`;
  }
  const delta = detail.endpointCount - previous.endpointCount;
  if (delta === 0) {
    return `${detail.version} is the same size as ${previous.version}.`;
  }
  return `${detail.version} ${delta > 0 ? "adds" : "drops"} ${Math.abs(delta)} ${plural(
    Math.abs(delta),
    "endpoint",
  )} against ${previous.version}.`;
}

export interface SectionVerdict {
  verdict: string;
  tone: StatTone;
}

export function shapeVerdict(
  detail: ProjectVersionDetail,
  versions: ProjectVersionDetail[],
): SectionVerdict {
  const ordered = versions.toSorted(byVersionAscending);
  const oldest = ordered[0];
  if (!oldest || ordered.length < 2) {
    return { verdict: "First upload", tone: "muted" };
  }
  if (oldest.version === detail.version) {
    return { verdict: "Baseline", tone: "muted" };
  }
  const growth = detail.endpointCount - oldest.endpointCount;
  if (growth > 0) return { verdict: "Growing", tone: "positive" };
  if (growth < 0) return { verdict: "Shrinking", tone: "negative" };
  return { verdict: "Steady", tone: "neutral" };
}

export function compositionVerdict(
  detail: ProjectVersionDetail,
): SectionVerdict {
  if (detail.httpRouteCount + detail.procedureCount === 0) {
    return { verdict: "Empty", tone: "negative" };
  }
  if (detail.procedureCount === 0) {
    return { verdict: "HTTP only", tone: "neutral" };
  }
  if (detail.httpRouteCount === 0) {
    return { verdict: "RPC only", tone: "neutral" };
  }
  return {
    verdict:
      detail.httpRouteCount >= detail.procedureCount ? "HTTP-led" : "RPC-led",
    tone: "neutral",
  };
}

export function inventoryVerdict(
  summary: ReturnType<typeof summarizeInventory>,
): SectionVerdict {
  if (summary.total === 0) return { verdict: "Empty", tone: "negative" };
  if (summary.dropped > 0)
    return { verdict: "Endpoints removed", tone: "negative" };
  if (summary.introduced > 0) return { verdict: "Expanded", tone: "positive" };
  return { verdict: "Unchanged", tone: "neutral" };
}

/** endpoint id → the versions it appears in, built once per sheet open. */
export type EndpointPresence = Map<string, Set<string>>;

export function buildEndpointPresence(
  versions: ProjectVersionDetail[],
): EndpointPresence {
  const presence: EndpointPresence = new Map();
  for (const version of versions) {
    for (const endpoint of version.endpointDetails) {
      const seen = presence.get(endpoint.id);
      if (seen) seen.add(version.version);
      else presence.set(endpoint.id, new Set([version.version]));
    }
  }
  return presence;
}

export function summarizeInventory({
  detail,
  previous,
  versions,
  presence,
}: {
  detail: ProjectVersionDetail;
  previous?: ProjectVersionDetail;
  versions: ProjectVersionDetail[];
  presence: EndpointPresence;
}) {
  const currentIds = new Set(
    detail.endpointDetails.map((endpoint) => endpoint.id),
  );
  const previousIds = new Set(
    previous?.endpointDetails.map((endpoint) => endpoint.id) ?? [],
  );

  return {
    total: detail.endpointDetails.length,
    stable: detail.endpointDetails.filter(
      (endpoint) => presence.get(endpoint.id)?.size === versions.length,
    ).length,
    introduced: previous
      ? detail.endpointDetails.filter(
          (endpoint) => !previousIds.has(endpoint.id),
        ).length
      : 0,
    dropped: previous
      ? [...previousIds].filter((id) => !currentIds.has(id)).length
      : 0,
  };
}

/** Short trailing qualifier for the inventory row: what changed, if anything. */
export function inventoryQualifier(
  summary: ReturnType<typeof summarizeInventory>,
): string {
  const parts: string[] = [];
  if (summary.introduced > 0) parts.push(`${summary.introduced} new`);
  if (summary.dropped > 0) parts.push(`${summary.dropped} removed`);
  if (parts.length === 0) return `${summary.stable} in every version`;
  return parts.join(", ");
}

function MetricSparkline({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const chartValues = values.length === 1 ? [values[0], values[0]] : values;
  const min = Math.min(...chartValues);
  const max = Math.max(...chartValues);
  const range = Math.max(max - min, 1);
  const points = chartValues
    .map((value, index) => {
      const x = (index / Math.max(chartValues.length - 1, 1)) * 72 + 4;
      const y = 28 - ((value - min) / range) * 20;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      className="h-9 w-20 overflow-visible"
      viewBox="0 0 80 36"
    >
      <path
        d="M4 31.5H76"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.12"
      />
      <polyline
        fill="none"
        points={points}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.25"
      />
      <circle
        cx="76"
        cy={Number(points.split(" ").at(-1)?.split(",")[1] ?? 28)}
        fill={color}
        r="3"
        stroke="var(--card)"
        strokeWidth="2"
      />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  previousValue,
  values,
  color,
}: {
  label: string;
  value: number;
  previousValue?: number;
  values: number[];
  color: string;
}) {
  const delta = previousValue === undefined ? null : value - previousValue;
  const DeltaIcon =
    delta === null || delta === 0
      ? Minus
      : delta > 0
        ? ArrowUpRight
        : ArrowDownRight;

  return (
    <div className="flex items-end justify-between gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0">
        <div className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1.5 font-mono text-3xl font-medium tracking-tight tabular-nums">
          {value}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
          <DeltaIcon aria-hidden="true" className="size-3" />
          {delta === null
            ? "First upload"
            : delta === 0
              ? "No change"
              : `${signed(delta)} from prior`}
        </div>
      </div>
      <MetricSparkline color={color} values={values} />
    </div>
  );
}

export function buildEndpointCoverage(
  endpointId: string,
  versions: ProjectVersionDetail[],
) {
  return versions
    .toSorted((left, right) => right.version.localeCompare(left.version))
    .map((version) => ({
      version: version.version,
      endpoint:
        version.endpointDetails.find(
          (endpoint) => endpoint.id === endpointId,
        ) ?? null,
    }));
}

function endpointKind(endpoint: ProjectVersionEndpointDetail): string {
  if (endpoint.transport === "http") {
    return endpoint.method ?? "HTTP";
  }
  if (endpoint.transport === "trpc") {
    return endpoint.procedureType?.toUpperCase() ?? "RPC";
  }
  return "OTHER";
}

function endpointBadgeClass(endpoint: ProjectVersionEndpointDetail): string {
  const kind = endpointKind(endpoint);
  if (kind === "GET")
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (kind === "POST")
    return "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300";
  if (kind === "PUT" || kind === "PATCH")
    return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  if (kind === "DELETE")
    return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300";
  if (kind === "QUERY")
    return "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300";
  if (kind === "MUTATION")
    return "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300";
  if (kind === "OPTIONS" || kind === "HEAD")
    return "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
  return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300";
}

function endpointName(endpoint: ProjectVersionEndpointDetail): string {
  if (endpoint.path) return endpoint.path;
  if (endpoint.procedure) return `trpc:${endpoint.procedure}`;
  return endpoint.id;
}

function EndpointCoverage({
  activity,
  activityStatus,
  endpoint,
  versions,
}: {
  activity?: EndpointRuntimeActivity;
  activityStatus: EndpointActivityStatus;
  endpoint: ProjectVersionEndpointDetail;
  versions: ProjectVersionDetail[];
}) {
  const coverage = buildEndpointCoverage(endpoint.id, versions);
  const present = coverage.filter((entry) => entry.endpoint !== null);
  const shapes = new Set(
    present.map(({ endpoint: candidate }) =>
      candidate
        ? [
            candidate.transport,
            candidate.method,
            candidate.procedureType,
            candidate.requestFieldCount,
            candidate.responseVariantCount,
          ].join(":")
        : "",
    ),
  ).size;
  const coveragePercent = Math.round((present.length / coverage.length) * 100);

  return (
    <AccordionItem value={endpoint.id}>
      <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_7rem]">
          <div className="flex min-w-0 items-center gap-3">
            <Badge
              className={`py-0 font-mono leading-none ${endpointBadgeClass(endpoint)}`}
              variant="outline"
            >
              <span className="translate-y-[0.5px]">
                {endpointKind(endpoint)}
              </span>
            </Badge>
            <span className="truncate font-mono text-xs">
              {endpointName(endpoint)}
            </span>
          </div>
          <span className="font-mono text-xs tabular-nums">
            {coveragePercent}%
          </span>
          <span className="hidden text-right font-mono text-xs tabular-nums sm:block">
            {activityStatus === "ready"
              ? compactNumber(activity?.requests ?? 0)
              : "—"}
          </span>
          <span className="hidden text-right text-xs text-muted-foreground sm:block">
            {activityStatus === "loading"
              ? "loading"
              : activityStatus === "unavailable"
                ? "unavailable"
                : activity
                  ? relativeTime(activity.lastSeen)
                  : "never"}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        <div className="overflow-hidden rounded-md border bg-muted/15">
          <div className="grid grid-cols-2 divide-x border-b bg-muted/35 sm:grid-cols-4">
            <EndpointFact
              label="First seen"
              value={present.at(-1)?.version ?? "—"}
            />
            <EndpointFact label="Contract shapes" value={shapes} />
            <EndpointFact
              label="Input fields"
              value={endpoint.requestFieldCount}
            />
            <EndpointFact
              label="Response shapes"
              value={endpoint.responseVariantCount}
            />
          </div>
          <div className="divide-y">
            {coverage.map(({ version, endpoint: candidate }) => (
              <div
                className="grid grid-cols-[minmax(7rem,1fr)_auto] items-center gap-4 px-3 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
                key={version}
              >
                <span className="font-mono text-xs">{version}</span>
                <span
                  className={
                    candidate
                      ? "inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                      : "inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  }
                >
                  {candidate ? (
                    <Check aria-hidden="true" className="size-3" />
                  ) : (
                    <CircleMinus aria-hidden="true" className="size-3" />
                  )}
                  {candidate ? "Present" : "Absent"}
                </span>
                <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-right">
                  {candidate
                    ? `${candidate.requestFieldCount} input ${plural(candidate.requestFieldCount, "field")} · ${candidate.responseVariantCount} response ${plural(candidate.responseVariantCount, "shape")}`
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function EndpointFact({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs tabular-nums">
        {value}
      </div>
    </div>
  );
}

export interface EndpointRuntimeActivity {
  route: string;
  requests: number;
  lastSeen: string;
}

export type EndpointActivityStatus = "loading" | "ready" | "unavailable";

export function filterEndpoints(
  endpoints: ProjectVersionEndpointDetail[],
  search: string,
) {
  const needle = search.trim().toLowerCase();
  if (!needle) return endpoints;
  return endpoints.filter(
    (endpoint) =>
      endpointName(endpoint).toLowerCase().includes(needle) ||
      endpointKind(endpoint).toLowerCase().includes(needle),
  );
}

/** Rows rendered before the reader asks for the rest of a large inventory. */
export const INVENTORY_PAGE_SIZE = 40;

function EndpointInventory({
  activity,
  activityStatus,
  detail,
  versions,
}: {
  activity: EndpointRuntimeActivity[];
  activityStatus: EndpointActivityStatus;
  detail: ProjectVersionDetail;
  versions: ProjectVersionDetail[];
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(INVENTORY_PAGE_SIZE);
  const matches = useMemo(
    () => filterEndpoints(detail.endpointDetails, search),
    [detail.endpointDetails, search],
  );
  const visible = matches.slice(0, limit);
  const hidden = matches.length - visible.length;
  const activityByRoute = useMemo(
    () => new Map(activity.map((row) => [row.route, row])),
    [activity],
  );

  if (detail.endpointDetails.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
        No endpoints were declared in this artifact.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          aria-label="Filter endpoints"
          className="max-w-64"
          onChange={(event) => {
            setSearch(event.target.value);
            setLimit(INVENTORY_PAGE_SIZE);
          }}
          placeholder="Filter by path or method…"
          type="search"
          value={search}
        />
        <span className="text-[0.6875rem] text-muted-foreground">
          {matches.length === detail.endpointDetails.length
            ? `${detail.endpointDetails.length} ${plural(detail.endpointDetails.length, "endpoint")}`
            : `${matches.length} of ${detail.endpointDetails.length} ${plural(detail.endpointDetails.length, "endpoint")}`}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
          No endpoint matches that filter.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:grid-cols-[minmax(0,1fr)_5rem_6rem_7rem]">
            <span>Endpoint</span>
            <span>Coverage</span>
            <span className="hidden text-right sm:block">Requests</span>
            <span className="hidden text-right sm:block">Last seen</span>
          </div>
          <Accordion className="rounded-none border-0" multiple>
            {visible.map((endpoint) => (
              <EndpointCoverage
                activity={activityByRoute.get(endpoint.id)}
                activityStatus={activityStatus}
                endpoint={endpoint}
                versions={versions}
                key={endpoint.id}
              />
            ))}
          </Accordion>
          {hidden > 0 ? (
            <div className="border-t px-4 py-3 text-center">
              <Button
                onClick={() =>
                  setLimit((current) => current + INVENTORY_PAGE_SIZE)
                }
                size="sm"
                variant="ghost"
              >
                Show {Math.min(hidden, INVENTORY_PAGE_SIZE)} more of {hidden}{" "}
                remaining
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SurfaceEvolution({ versions }: { versions: ProjectVersionDetail[] }) {
  const data = buildVersionTrend(versions);

  return (
    <ReportPanel
      className="relative"
      description="Contract size across every uploaded version."
      title="Surface evolution"
    >
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
        <LineChart data={data} margin={{ left: -16, right: 12, top: 10 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="version"
            minTickGap={24}
            tickFormatter={(value: string) => value.slice(5)}
            tickLine={false}
            tickMargin={10}
          />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
          <Line
            dataKey="endpoints"
            dot={{ fill: "var(--color-endpoints)", r: 3 }}
            stroke="var(--color-endpoints)"
            strokeWidth={2.5}
            type="monotone"
          />
          <Line
            dataKey="models"
            dot={{ fill: "var(--color-models)", r: 3 }}
            stroke="var(--color-models)"
            strokeWidth={2}
            type="monotone"
          />
          <Line
            dataKey="procedures"
            dot={{ fill: "var(--color-procedures)", r: 3 }}
            stroke="var(--color-procedures)"
            strokeWidth={2}
            type="monotone"
          />
          <ChartLegend content={<ChartLegendContent />} />
        </LineChart>
      </ChartContainer>
      {data.length === 1 ? (
        <div className="pointer-events-none absolute inset-x-4 top-1/2 flex justify-center">
          <span className="rounded-full border bg-background/90 px-3 py-1.5 text-[0.6875rem] text-muted-foreground shadow-sm backdrop-blur">
            Upload another version to reveal the trend
          </span>
        </div>
      ) : null}
    </ReportPanel>
  );
}

function SurfaceMix({ detail }: { detail: ProjectVersionDetail }) {
  const http = detail.httpRouteCount;
  const rpc = detail.procedureCount;
  const total = Math.max(http + rpc, 1);
  const httpPercent = Math.round((http / total) * 100);
  const rpcPercent = Math.round((rpc / total) * 100);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ReportPanel
        description="HTTP routes against RPC procedures."
        title="Transport split"
      >
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="bg-[var(--chart-1)]"
            style={{ width: `${httpPercent}%` }}
          />
          <div
            className="bg-[var(--chart-3)]"
            style={{ width: `${rpcPercent}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2 rounded-full bg-[var(--chart-1)]" />
              HTTP routes
            </div>
            <div className="mt-1 font-mono text-xl tabular-nums">
              {http}{" "}
              <span className="text-xs text-muted-foreground">
                {httpPercent}%
              </span>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2 rounded-full bg-[var(--chart-3)]" />
              RPC procedures
            </div>
            <div className="mt-1 font-mono text-xl tabular-nums">
              {rpc}{" "}
              <span className="text-xs text-muted-foreground">
                {rpcPercent}%
              </span>
            </div>
          </div>
        </div>
      </ReportPanel>

      <ReportPanel
        description="How the HTTP surface is distributed."
        title="HTTP methods"
      >
        {detail.methods.length ? (
          <div className="space-y-3">
            {detail.methods.map(({ method, count }) => (
              <div
                className="grid grid-cols-[3rem_1fr_auto] items-center gap-3"
                key={method}
              >
                <span className="font-mono text-xs">{method}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{
                      width: `${Math.max((count / Math.max(http, 1)) * 100, 4)}%`,
                    }}
                  />
                </div>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {count}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No HTTP routes declared.</p>
        )}
      </ReportPanel>
    </div>
  );
}

export function VersionContractDetails({
  endpointActivity = [],
  endpointActivityStatus = "ready",
  detail,
  versions,
  runtime,
  runtimeSectionCount = 0,
  defaultExpanded = false,
}: {
  endpointActivity?: EndpointRuntimeActivity[];
  endpointActivityStatus?: EndpointActivityStatus;
  detail: ProjectVersionDetail;
  versions: ProjectVersionDetail[];
  runtime?: ReactNode;
  /** Sections the runtime node contributes, so reference sections keep numbering. */
  runtimeSectionCount?: number;
  defaultExpanded?: boolean;
}) {
  const orderedVersions = useMemo(
    () =>
      versions.toSorted((left, right) =>
        right.version.localeCompare(left.version),
      ),
    [versions],
  );
  const currentIndex = orderedVersions.findIndex(
    (version) => version.id === detail.id,
  );
  const previous = orderedVersions[currentIndex + 1];
  const presence = useMemo(() => buildEndpointPresence(versions), [versions]);
  const inventory = useMemo(
    () => summarizeInventory({ detail, previous, versions, presence }),
    [detail, presence, previous, versions],
  );

  const referenceIndex = (offset: number) =>
    String(2 + runtimeSectionCount + offset).padStart(2, "0");

  const shape = shapeVerdict(detail, versions);
  const composition = compositionVerdict(detail);
  const inventoryState = inventoryVerdict(inventory);
  const endpointDelta = previous
    ? detail.endpointCount - previous.endpointCount
    : null;
  const surfaceTotal = Math.max(
    detail.httpRouteCount + detail.procedureCount,
    1,
  );
  const httpShare = Math.round((detail.httpRouteCount / surfaceTotal) * 100);

  return (
    <Report defaultExpanded={defaultExpanded}>
      <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
        <ReportLead
          headline={buildContractHeadline(detail, versions, previous)}
        >
          <ReportHeadlineStat
            hint={endpointDelta === null ? undefined : signed(endpointDelta)}
            label="Endpoints"
            tone={
              endpointDelta === null || endpointDelta === 0
                ? "neutral"
                : endpointDelta > 0
                  ? "positive"
                  : "negative"
            }
            value={detail.endpointCount}
          />
          <ReportHeadlineStat label="Models" value={detail.modelCount} />
          <ReportHeadlineStat
            label="Model fields"
            value={detail.schemaFieldCount}
          />
          <ReportHeadlineStat
            hint={relativeTime(detail.uploadedAt)}
            label="Versions on file"
            value={versions.length}
          />
        </ReportLead>
        <ReportControls className="-mr-2 shrink-0" />
      </div>

      <ReportGroupHeading>Contract</ReportGroupHeading>

      <ReportSection
        id="shape"
        index="01"
        metric={detail.endpointCount}
        metricLabel="endpoints"
        qualifier={
          endpointDelta === null
            ? "first upload"
            : `${signed(endpointDelta)} vs ${previous?.version}`
        }
        title="Shape of the contract"
        verdict={shape.verdict}
        verdictTone={shape.tone}
        visual={<Sparkline values={metricHistory(versions, "endpointCount")} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              color="var(--chart-1)"
              label="Endpoints"
              previousValue={previous?.endpointCount}
              value={detail.endpointCount}
              values={metricHistory(versions, "endpointCount")}
            />
            <MetricCard
              color="var(--chart-2)"
              label="Models"
              previousValue={previous?.modelCount}
              value={detail.modelCount}
              values={metricHistory(versions, "modelCount")}
            />
            <MetricCard
              color="var(--chart-4)"
              label="Model fields"
              previousValue={previous?.schemaFieldCount}
              value={detail.schemaFieldCount}
              values={metricHistory(versions, "schemaFieldCount")}
            />
            <MetricCard
              color="var(--chart-3)"
              label="RPC procedures"
              previousValue={previous?.procedureCount}
              value={detail.procedureCount}
              values={metricHistory(versions, "procedureCount")}
            />
          </div>
          <SurfaceEvolution versions={versions} />
        </div>
      </ReportSection>

      <ReportSection
        id="composition"
        index="02"
        metric={`${httpShare}%`}
        metricLabel="HTTP"
        qualifier={`${detail.httpRouteCount} ${plural(
          detail.httpRouteCount,
          "route",
        )} · ${detail.procedureCount} rpc`}
        title="Surface mix"
        verdict={composition.verdict}
        verdictTone={composition.tone}
        visual={
          <SplitBar
            segments={[
              { value: detail.httpRouteCount, color: "var(--chart-1)" },
              { value: detail.procedureCount, color: "var(--chart-3)" },
            ]}
          />
        }
      >
        <SurfaceMix detail={detail} />
      </ReportSection>

      {runtime}

      <ReportGroupHeading>Reference</ReportGroupHeading>

      <ReportSection
        id="inventory"
        index={referenceIndex(1)}
        metric={inventory.total}
        metricLabel="declared"
        qualifier={inventoryQualifier(inventory)}
        title="Endpoint inventory"
        verdict={inventoryState.verdict}
        verdictTone={inventoryState.tone}
        visual={
          <SplitBar
            segments={[
              { value: inventory.stable, color: "var(--chart-2)" },
              { value: inventory.introduced, color: "var(--chart-1)" },
              { value: inventory.dropped, color: "var(--chart-5)" },
            ]}
          />
        }
      >
        <EndpointInventory
          activity={endpointActivity}
          activityStatus={endpointActivityStatus}
          detail={detail}
          versions={versions}
        />
      </ReportSection>

      <ReportSection
        id="provenance"
        index={referenceIndex(2)}
        metric={
          detail.provenance?.sha ? detail.provenance.sha.slice(0, 12) : "—"
        }
        metricLabel={detail.provenance?.sha ? "commit" : "no commit recorded"}
        qualifier={detail.provenance?.repo ?? detail.tool ?? undefined}
        title="Artifact & provenance"
        verdict={detail.provenance?.repo ? "Traced" : "Untraced"}
        verdictTone={detail.provenance?.repo ? "neutral" : "muted"}
      >
        <ReportPanel className="grid gap-5 sm:grid-cols-[1fr_auto_1fr]">
          <div>
            <div className="mb-1 text-[0.625rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Artifact
            </div>
            <div className="font-mono">
              {detail.tool ?? "unknown generator"}
            </div>
            <div className="mt-1 text-muted-foreground">
              uploaded {relativeTime(detail.uploadedAt)} · hash{" "}
              <span className="font-mono text-foreground">
                {detail.integrityHash}
              </span>
            </div>
          </div>
          <Separator
            className="hidden h-full sm:block"
            orientation="vertical"
          />
          <div>
            <div className="mb-1 flex items-center gap-1 text-[0.625rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <GitBranch aria-hidden="true" className="size-3" />
              Provenance
            </div>
            {detail.provenance ? (
              <>
                <div className="truncate font-mono">
                  {detail.provenance.repo ?? "repository unavailable"}
                </div>
                <div className="mt-1 truncate font-mono text-muted-foreground">
                  {detail.provenance.ref ?? "unknown ref"}
                  {detail.provenance.sha
                    ? ` · ${detail.provenance.sha.slice(0, 12)}`
                    : ""}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">
                No CI provenance recorded.
              </div>
            )}
          </div>
        </ReportPanel>
      </ReportSection>
    </Report>
  );
}
