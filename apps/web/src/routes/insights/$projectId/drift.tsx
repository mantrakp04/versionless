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
import Loader from "@/components/loader";
import { useInsightsContext } from "@/hooks/use-insights-context";
import {
  transformDepthQueryOptions,
  type TransformDepthSort,
} from "@/queries/insights";

export const Route = createFileRoute("/insights/$projectId/drift")({
  component: DriftPage,
});

const chartConfig = {
  avgDepth: { label: "Avg depth", color: "var(--chart-1)" },
  p95Depth: { label: "p95 depth", color: "var(--chart-3)" },
} satisfies ChartConfig;

function DriftPage() {
  const { project, days } = useInsightsContext();
  const { sort, direction, toggleSort } = useTableSort<TransformDepthSort>("avg");
  const selectedRange =
    INSIGHTS_TIME_RANGES.find((range) => range.days === days) ??
    INSIGHTS_TIME_RANGES[2];

  const drift = useQuery(
    transformDepthQueryOptions({
      days,
      projectId: project.id,
      sort,
      direction,
    }),
  );

  const rows = drift.data ?? [];
  const offline = isTelemetryOffline(drift.error);

  return (
    <InsightsPage
      title="Transform depth"
      description="How many transforms deep old clients run per endpoint — high depth = migration nudge candidates."
    >
      {offline ? (
        <OfflineCard error={drift.error} />
      ) : drift.isLoading ? (
        <Loader />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Depth by route</CardTitle>
              <CardDescription>
                Average and p95 transform chain length per endpoint,{" "}
                {selectedRange.description}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No request data in the selected window.
                </p>
              ) : (
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto w-full"
                  style={{ height: Math.max(160, rows.length * 44 + 60) }}
                >
                  <BarChart
                    data={rows}
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
              <CardTitle>Per-route detail</CardTitle>
            </CardHeader>
            <CardContent>
              <DashboardTable
                items={rows}
                getItemKey={(row) => row.route}
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
                      label="Avg depth"
                      column="avg"
                      sort={sort}
                      direction={direction}
                      onSort={toggleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="p95 depth"
                      column="p95"
                      sort={sort}
                      direction={direction}
                      onSort={toggleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Max depth"
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
