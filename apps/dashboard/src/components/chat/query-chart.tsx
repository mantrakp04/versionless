import { useMemo } from "react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@versionless/ui/components/chart";
import { Skeleton } from "@versionless/ui/components/skeleton";
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

import { clientErrorMessage } from "@/utils/client-error";
import type { QueryParameter } from "@/utils/project-query";
import type { QuerySource } from "./query-sql";
import type { QueryRunner } from "./query-runner";
import { useSourceQuery } from "./use-source-query";

/**
 * Shared with the adoption chart so the assistant's charts read as part of the
 * same dashboard rather than a different product.
 */
const SERIES_COLORS = [
  "#2563eb",
  "#ea580c",
  "#059669",
  "#7c3aed",
  "#db2777",
  "#0891b2",
];

/** Enough lines to see a shape; beyond this a chart is unreadable anyway. */
const DEFAULT_TOP_N = 6;

export interface QueryChartProps {
  source?: QuerySource;
  query: string;
  params?: Record<string, QueryParameter> | QueryParameter[];
  type?: "line" | "bar" | "area";
  /** Column holding the category / time axis. */
  x: string;
  /** Column holding the value. */
  y: string;
  /** Optional column to split into one series per distinct value. */
  series?: string;
  topN?: number;
  caption?: string;
}

type Row = Record<string, unknown>;
type Point = Record<string, string | number>;

/**
 * Pivots flat `x, series, y` rows into one object per x value, keeping only the
 * `topN` series by total magnitude. Exported for tests: the pivot is where a
 * sparse series silently disappears if the zero-fill is wrong.
 */
export function pivotSeries(
  rows: Row[],
  input: { x: string; y: string; series?: string; topN: number },
): { keys: string[]; data: Point[] } {
  if (rows.length === 0) return { keys: [], data: [] };

  if (!input.series) {
    return {
      keys: [input.y],
      data: rows.map((row) => ({
        [input.x]: String(row[input.x] ?? ""),
        [input.y]: Number(row[input.y] ?? 0),
      })),
    };
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[input.series] ?? "");
    totals.set(key, (totals.get(key) ?? 0) + Number(row[input.y] ?? 0));
  }
  const keys = [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, input.topN)
    .map(([key]) => key);
  const kept = new Set(keys);

  const byX = new Map<string, Point>();
  for (const row of rows) {
    const seriesKey = String(row[input.series] ?? "");
    if (!kept.has(seriesKey)) continue;
    const xValue = String(row[input.x] ?? "");
    let point = byX.get(xValue);
    if (!point) {
      // Zero-fill every kept series so a bucket a version was absent from
      // renders as zero rather than breaking the line.
      point = { [input.x]: xValue };
      for (const key of keys) point[key] = 0;
      byX.set(xValue, point);
    }
    point[seriesKey] = Number(row[input.y] ?? 0);
  }
  return {
    keys,
    data: [...byX.values()].sort((left, right) =>
      String(left[input.x]).localeCompare(String(right[input.x])),
    ),
  };
}

export function QueryChart({
  projectId,
  source = "clickhouse",
  query,
  params,
  type = "line",
  x,
  y,
  series,
  topN = DEFAULT_TOP_N,
  caption,
  runQuery,
}: QueryChartProps & { projectId: string; runQuery: QueryRunner }) {
  const result = useSourceQuery<Row>({
    name: "chart",
    projectId,
    source,
    query,
    params,
    runQuery,
  });

  const { keys, data } = useMemo(
    () => pivotSeries(result.data ?? [], { x, y, series, topN }),
    [result.data, series, topN, x, y],
  );

  const config = useMemo(() => {
    const entries: ChartConfig = {};
    keys.forEach((key, index) => {
      entries[key] = {
        label: key,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      };
    });
    return entries;
  }, [keys]);

  if (result.isPending) {
    return <Skeleton className="my-3 h-56 w-full" />;
  }
  if (result.isError) {
    return (
      <p className="my-3 text-destructive text-xs">
        {clientErrorMessage(result.error, "This chart could not be loaded.")}
      </p>
    );
  }
  if (data.length === 0) {
    return (
      <p className="my-3 text-muted-foreground text-xs">
        No data for this chart.
      </p>
    );
  }

  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        axisLine={false}
        dataKey={x}
        minTickGap={24}
        tickLine={false}
        tickMargin={8}
      />
      <YAxis axisLine={false} tickLine={false} width={44} />
      <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
    </>
  );

  return (
    <div className="my-3 flex flex-col gap-2">
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        {type === "bar" ? (
          <BarChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
            {axes}
            {keys.map((key) => (
              <Bar
                dataKey={key}
                fill={`var(--color-${key})`}
                key={key}
                stackId={keys.length > 1 ? "stack" : undefined}
              />
            ))}
          </BarChart>
        ) : type === "area" ? (
          <AreaChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
            {axes}
            {keys.map((key) => (
              <Area
                dataKey={key}
                fill={`var(--color-${key})`}
                fillOpacity={0.35}
                key={key}
                stackId="stack"
                stroke={`var(--color-${key})`}
                type="monotone"
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
            {axes}
            {keys.map((key) => (
              <Line
                dataKey={key}
                dot={false}
                key={key}
                stroke={`var(--color-${key})`}
                type="monotone"
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
      {caption ? (
        <p className="text-muted-foreground text-xs">{caption}</p>
      ) : null}
    </div>
  );
}
