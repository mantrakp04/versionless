import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
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
import { TableCell } from "@versionless/ui/components/table";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useMemo } from "react";

import { DashboardTable } from "@/components/dashboard-table";
import { InsightsPage } from "@/components/insights/insights-page";
import {
  OfflineCard,
  isTelemetryOffline,
} from "@/components/insights/offline-card";
import {
  SortableTableHead,
  useTableSort,
} from "@/components/insights/sortable-table-head";
import { INSIGHTS_TIME_RANGES } from "@/components/insights/time-range-control";
import { HorizontalBarChartSkeleton } from "@/components/loader";
import { useInsightsContext } from "@/hooks/use-insights-context";
import {
  transformDepthQueryOptions,
  selectTransformDepthChartRows,
  type TransformDepthSort,
} from "@/queries/insights";

export const Route = createFileRoute("/insights/$projectId/overhead")({
  component: VersionOverheadPage,
});

const chartConfig = {
  avgDepth: { label: "Average changes", color: "var(--chart-1)" },
  p95Depth: { label: "95% within", color: "var(--chart-3)" },
} satisfies ChartConfig;

const OVERHEAD_GRID_COLUMNS =
  "minmax(14rem, 2fr) repeat(4, minmax(5rem, .7fr))";

function VersionOverheadPage() {
  const { project, days } = useInsightsContext();
  const { sort, direction, toggleSort } =
    useTableSort<TransformDepthSort>("avg");
  const selectedRange =
    INSIGHTS_TIME_RANGES.find((range) => range.days === days) ??
    INSIGHTS_TIME_RANGES[2];

  const overhead = useQuery(
    transformDepthQueryOptions({
      days,
      projectId: project.id,
      sort,
      direction,
    }),
  );

  const rows = overhead.data ?? [];
  const chartRows = useMemo(
    () => selectTransformDepthChartRows(rows),
    [rows],
  );
  const offline = isTelemetryOffline(overhead.error);

  return (
    <InsightsPage title="Version overhead">
      {offline ? (
        <OfflineCard error={overhead.error} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>API changes bridged by route</CardTitle>
              <CardDescription>
                Average compatibility work for the 16 busiest routes,{" "}
                {selectedRange.description}. Zero means the client already uses
                the current API; higher values mean more API changes must be
                bridged.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overhead.isLoading ? (
                <HorizontalBarChartSkeleton />
              ) : rows.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No request data in the selected window.
                </p>
              ) : (
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto w-full"
                  style={{ height: Math.max(160, chartRows.length * 36 + 60) }}
                >
                  <BarChart
                    data={chartRows}
                    layout="vertical"
                    margin={{ left: 8, right: 12 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="route"
                      tickLine={false}
                      axisLine={false}
                      width={150}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent indicator="line" />}
                    />
                    <Bar
                      dataKey="avgDepth"
                      fill="var(--color-avgDepth)"
                      radius={2}
                    />
                    <Bar
                      dataKey="p95Depth"
                      fill="var(--color-p95Depth)"
                      radius={2}
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Route breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <DashboardTable
                items={rows}
                isLoading={overhead.isLoading}
                isError={overhead.isError}
                errorState="Version overhead is temporarily unavailable."
                getItemKey={(row) => row.route}
                gridTemplateColumns={OVERHEAD_GRID_COLUMNS}
                renderHeader={() => (
                  <>
                    <SortableTableHead
                      label="Route"
                      column="route"
                      sort={sort}
                      direction={direction}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Average changes"
                      column="avg"
                      sort={sort}
                      direction={direction}
                      onSort={toggleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="95% within"
                      column="p95"
                      sort={sort}
                      direction={direction}
                      onSort={toggleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Maximum changes"
                      column="max"
                      sort={sort}
                      direction={direction}
                      onSort={toggleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Requests"
                      column="requests"
                      sort={sort}
                      direction={direction}
                      onSort={toggleSort}
                      align="right"
                    />
                  </>
                )}
                renderRow={(row) => (
                  <>
                    <TableCell className="font-mono">{row.route}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.avgDepth.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.p95Depth.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.maxDepth}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.requests.toLocaleString()}
                    </TableCell>
                  </>
                )}
                emptyState="No request data in the selected window."
              />
            </CardContent>
          </Card>
        </>
      )}
    </InsightsPage>
  );
}
