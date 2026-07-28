import { useCallback, useMemo, useState } from "react";
import type { AdoptionPoint } from "@/queries/insights";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@versionless/ui/components/chart";
import { Button } from "@versionless/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@versionless/ui/components/dropdown-menu";
import { ScrollArea } from "@versionless/ui/components/scroll-area";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { ChevronDown } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { plural } from "./format";

export const ADOPTION_CHART_COLORS = [
  "#2563eb",
  "#ea580c",
  "#059669",
  "#7c3aed",
  "#db2777",
];
/**
 * A long-lived API keeps more than three versions in flight at once, and the
 * ones a migration campaign cares about are usually the stragglers below the
 * top three. Five is where stacked areas stay individually readable.
 */
export const MAX_ADOPTION_VERSIONS = 5;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Consumer counts ride alongside each version's request count in the same
 * bucket. Recharts only plots the dataKeys handed to an `<Area>`, so these keys
 * are inert in the chart and exist for the tooltip: 900 requests from one
 * caller and 900 from ninety are different migration problems.
 */
export function adoptionClientsKey(version: string): string {
  return `${version} clients`;
}

function hourlyBucket(date: Date): string {
  return date.toISOString().slice(0, 13).replace("T", " ") + ":00:00";
}

function normalizeHourlyBucket(bucket: string): string {
  return `${bucket.slice(0, 13)}:00:00`;
}

/** Pivot flat bucket/version rows into chart objects keyed by version. */
export function buildAdoptionSeries(
  rows: AdoptionPoint[],
  options: { hourly?: boolean; now?: Date } = {},
) {
  const versions = [...new Set(rows.map((r) => r.version))].sort();
  const byBucket = new Map<string, Record<string, number | string>>();
  if (options.hourly && versions.length > 0) {
    const currentHour = new Date(options.now ?? Date.now());
    currentHour.setUTCMinutes(0, 0, 0);
    for (let offset = 24; offset >= 0; offset--) {
      const bucket = hourlyBucket(
        new Date(currentHour.getTime() - offset * HOUR_MS),
      );
      byBucket.set(bucket, {
        bucket,
        ...Object.fromEntries(
          versions.flatMap((version) => [
            [version, 0],
            [adoptionClientsKey(version), 0],
          ]),
        ),
      });
    }
  }
  for (const row of rows) {
    const bucket = options.hourly
      ? normalizeHourlyBucket(row.bucket)
      : row.bucket;
    let entry = byBucket.get(bucket);
    if (!entry) {
      entry = { bucket };
      for (const version of versions) {
        entry[version] = 0;
        entry[adoptionClientsKey(version)] = 0;
      }
      byBucket.set(bucket, entry);
    }
    entry[row.version] = row.requests;
    entry[adoptionClientsKey(row.version)] = row.clients;
  }
  const data = [...byBucket.values()].sort((a, b) =>
    String(a.bucket).localeCompare(String(b.bucket)),
  );
  return { versions, data };
}

export function formatAdoptionTick(value: string, hourly: boolean) {
  return hourly ? value.slice(11, 16) : value.slice(5, 10);
}

export function getDefaultAdoptionVersions(
  versions: string[],
  limit = MAX_ADOPTION_VERSIONS,
): string[] {
  return versions
    .toSorted((left, right) => right.localeCompare(left))
    .slice(0, limit);
}

export function toggleAdoptionVersion(
  selected: ReadonlySet<string>,
  version: string,
  limit = MAX_ADOPTION_VERSIONS,
): Set<string> {
  const next = new Set(selected);
  if (next.has(version)) {
    next.delete(version);
  } else if (next.size < limit) {
    next.add(version);
  }
  return next;
}

export function resolveActiveAdoptionVersions(
  selected: ReadonlySet<string> | null,
  orderedVersions: string[],
  defaultVersions: string[],
): string[] {
  if (selected === null) return defaultVersions;
  if (selected.size === 0) return [];

  const available = orderedVersions.filter((version) => selected.has(version));
  return available.length > 0 ? available : defaultVersions;
}

export function AdoptionChartSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading adoption curve"
      className="flex h-64 w-full flex-col justify-between pt-2"
    >
      <div
        aria-hidden="true"
        className="grid min-h-0 flex-1 grid-cols-[2rem_1fr] gap-3"
      >
        <div className="flex flex-col justify-between py-1">
          {["w-8", "w-6", "w-7", "w-4"].map((widthClass) => (
            <Skeleton key={widthClass} className={`h-2 ${widthClass}`} />
          ))}
        </div>
        <div className="relative overflow-hidden border-b border-l border-border/60">
          <div className="absolute inset-0 flex flex-col justify-between">
            {Array.from({ length: 4 }, (_, index) => (
              <span key={index} className="block border-t border-border/40" />
            ))}
          </div>
          <svg
            viewBox="0 0 760 180"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full animate-pulse"
          >
            <path
              className="fill-muted/45"
              d="M0 164 C45 122 73 128 112 102 C152 74 187 121 232 91 C276 62 313 89 350 75 C401 55 432 99 478 73 C522 48 554 65 603 49 C649 34 704 72 760 38 L760 180 L0 180 Z"
            />
            <path
              className="fill-muted"
              d="M0 170 C54 150 88 156 127 139 C176 118 203 150 252 124 C298 99 333 132 380 110 C426 88 463 116 511 92 C556 70 596 107 641 82 C686 58 724 94 760 70 L760 180 L0 180 Z"
            />
          </svg>
        </div>
      </div>
      <div aria-hidden="true" className="flex justify-center gap-4 pt-4">
        {["w-16", "w-20", "w-16", "w-20"].map((widthClass, index) => (
          <div
            key={`${widthClass}-${index}`}
            className="flex items-center gap-1.5"
          >
            <Skeleton className="size-2 rounded-[2px]" />
            <Skeleton className={`h-2 ${widthClass}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdoptionChart({
  rows,
  hourly = false,
}: {
  rows: AdoptionPoint[];
  hourly?: boolean;
}) {
  const [renderedAt] = useState(() => new Date());
  const { versions, data } = useMemo(
    () => buildAdoptionSeries(rows, { hourly, now: renderedAt }),
    [hourly, renderedAt, rows],
  );
  const [selectedVersions, setSelectedVersions] = useState<Set<string> | null>(
    null,
  );
  const orderedVersions = useMemo(
    () => getDefaultAdoptionVersions(versions, versions.length),
    [versions],
  );
  const defaultVersions = useMemo(
    () => orderedVersions.slice(0, MAX_ADOPTION_VERSIONS),
    [orderedVersions],
  );
  const activeVersions = useMemo(
    () =>
      resolveActiveAdoptionVersions(
        selectedVersions,
        orderedVersions,
        defaultVersions,
      ),
    [defaultVersions, orderedVersions, selectedVersions],
  );

  const config = useMemo(() => {
    const entries: ChartConfig = {};
    activeVersions.forEach((version, index) => {
      entries[version] = {
        label: version,
        color: ADOPTION_CHART_COLORS[index],
      };
    });
    return entries;
  }, [activeVersions]);

  const toggleVersion = useCallback(
    (version: string) => {
      setSelectedVersions((current) =>
        toggleAdoptionVersion(
          current ?? new Set(getDefaultAdoptionVersions(versions)),
          version,
        ),
      );
    },
    [versions],
  );

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        No adoption data in the selected window.
      </p>
    );
  }

  return (
    <div className="flex h-64 w-full flex-col">
      <ChartContainer config={config} className="aspect-auto min-h-0 flex-1">
        <AreaChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="bucket"
            minTickGap={24}
            tickLine={false}
            tickMargin={8}
            tickFormatter={(value: string) => formatAdoptionTick(value, hourly)}
          />
          <YAxis axisLine={false} tickLine={false} width={44} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name, item) => {
                  const clients = Number(
                    (item?.payload as Record<string, unknown> | undefined)?.[
                      adoptionClientsKey(String(name))
                    ] ?? 0,
                  );
                  return (
                    <>
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: item?.color }}
                      />
                      <span className="flex flex-1 items-center justify-between gap-4 leading-none">
                        <span className="font-mono text-muted-foreground">
                          {String(name)}
                        </span>
                        <span className="font-mono tabular-nums">
                          {Number(value).toLocaleString()}
                          <span className="ml-2 text-muted-foreground">
                            {clients.toLocaleString()}{" "}
                            {plural(clients, "client")}
                          </span>
                        </span>
                      </span>
                    </>
                  );
                }}
                indicator="dot"
              />
            }
          />
          {activeVersions.map((version) => (
            <Area
              dataKey={version}
              fill={`var(--color-${version})`}
              fillOpacity={0.35}
              key={version}
              stackId="adoption"
              stroke={`var(--color-${version})`}
              type="monotone"
            />
          ))}
        </AreaChart>
      </ChartContainer>
      <AdoptionLegend
        activeVersions={activeVersions}
        versions={versions}
        onToggle={toggleVersion}
      />
    </div>
  );
}

export function AdoptionLegend({
  activeVersions,
  versions,
  onToggle,
}: {
  activeVersions: string[];
  versions: string[];
  onToggle: (version: string) => void;
}) {
  const active = new Set(activeVersions);
  const orderedVersions = getDefaultAdoptionVersions(versions, versions.length);

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
      {activeVersions.map((version, index) => {
        return (
          <button
            aria-label={`Hide version ${version}`}
            aria-pressed="true"
            className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            key={version}
            onClick={() => onToggle(version)}
            title={`Hide version ${version}`}
            type="button"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-[2px]"
              style={{
                backgroundColor: ADOPTION_CHART_COLORS[index],
              }}
            />
            <span className="font-mono">{version}</span>
          </button>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Choose chart versions"
              size="icon-sm"
              title="Choose chart versions"
              variant="outline"
            />
          }
        >
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-56" side="top">
          <ScrollArea className="h-72">
            <DropdownMenuGroup className="pr-3">
              {orderedVersions.map((version, index) => {
                const isActive = active.has(version);
                const atLimit =
                  active.size >= MAX_ADOPTION_VERSIONS && !isActive;
                return (
                  <DropdownMenuCheckboxItem
                    checked={isActive}
                    disabled={atLimit}
                    key={version}
                    onCheckedChange={() => onToggle(version)}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-[2px]"
                      style={{
                        backgroundColor:
                          ADOPTION_CHART_COLORS[
                            isActive
                              ? activeVersions.indexOf(version)
                              : index % ADOPTION_CHART_COLORS.length
                          ],
                      }}
                    />
                    <span className="font-mono">{version}</span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
          </ScrollArea>
          {versions.length > MAX_ADOPTION_VERSIONS ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  Deselect one to choose another.
                </DropdownMenuLabel>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
