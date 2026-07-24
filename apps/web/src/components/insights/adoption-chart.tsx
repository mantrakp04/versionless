import { useCallback, useMemo, useState } from "react";
import type { AdoptionPoint } from "@/queries/insights";
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@versionless/ui/components/chart";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Pivot flat bucket/version rows into chart objects keyed by version. */
export function buildAdoptionSeries(rows: AdoptionPoint[]) {
  const versions = [...new Set(rows.map((r) => r.version))].sort();
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const row of rows) {
    let entry = byBucket.get(row.bucket);
    if (!entry) {
      entry = { bucket: row.bucket };
      for (const version of versions) {
        entry[version] = 0;
      }
      byBucket.set(row.bucket, entry);
    }
    entry[row.version] = row.requests;
  }
  const data = [...byBucket.values()].sort((a, b) =>
    String(a.bucket).localeCompare(String(b.bucket)),
  );
  return { versions, data };
}

export function formatAdoptionTick(value: string, hourly: boolean) {
  return hourly ? value.slice(11, 16) : value.slice(5, 10);
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
              <span
                key={index}
                className="block border-t border-border/40"
              />
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
  const { versions, data } = useMemo(
    () => buildAdoptionSeries(rows),
    [rows],
  );
  const [hiddenVersions, setHiddenVersions] = useState<Set<string>>(
    () => new Set(),
  );

  const config = useMemo(() => {
    const entries: ChartConfig = {};
    versions.forEach((version, i) => {
      entries[version] = {
        label: version,
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    });
    return entries;
  }, [versions]);

  const toggleVersion = useCallback((version: string) => {
    setHiddenVersions((current) => {
      const next = new Set(current);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  }, []);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        No adoption data in the selected window.
      </p>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(value: string) => formatAdoptionTick(value, hourly)}
        />
        <YAxis tickLine={false} axisLine={false} width={44} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        {versions.map((version) => (
          <Area
            key={version}
            dataKey={version}
            hide={hiddenVersions.has(version)}
            type="monotone"
            stackId="adoption"
            stroke={`var(--color-${version})`}
            fill={`var(--color-${version})`}
            fillOpacity={0.35}
          />
        ))}
        <ChartLegend
          content={
            <AdoptionLegend
              versions={versions}
              hiddenVersions={hiddenVersions}
              onToggle={toggleVersion}
            />
          }
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function AdoptionLegend({
  versions,
  hiddenVersions,
  onToggle,
}: {
  versions: string[];
  hiddenVersions: ReadonlySet<string>;
  onToggle: (version: string) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-4 pt-3">
      {versions.map((version, index) => {
        const isVisible = !hiddenVersions.has(version);

        return (
          <button
            key={version}
            type="button"
            aria-label={`${isVisible ? "Hide" : "Show"} ${version}`}
            aria-pressed={isVisible}
            className="flex items-center gap-1.5 rounded-sm text-xs transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-pressed=false:opacity-40"
            onClick={() => onToggle(version)}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{
                backgroundColor:
                  CHART_COLORS[index % CHART_COLORS.length],
              }}
            />
            <span className={isVisible ? undefined : "line-through"}>
              {version}
            </span>
          </button>
        );
      })}
    </div>
  );
}
