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
  AdoptionChart,
  AdoptionChartSkeleton,
} from "@/components/insights/adoption-chart";
import { InsightsPage } from "@/components/insights/insights-page";
import {
  isTelemetryOffline,
  TelemetryOfflineState,
} from "@/components/insights/offline-card";
import { INSIGHTS_TIME_RANGES } from "@/components/insights/time-range-control";
import { useTableSort } from "@/components/insights/sortable-table-head";
import { VersionsTable } from "@/components/insights/versions-table";
import { useInsightsContext } from "@/hooks/use-insights-context";
import {
  adoptionQueryOptions,
  type VersionSort,
} from "@/queries/insights";

export const Route = createFileRoute("/insights/$projectId/")({
  component: InsightsOverview,
});

function InsightsOverview() {
  const { project, days } = useInsightsContext();
  const {
    sort: versionSort,
    direction: versionDirection,
    toggleSort: sortVersions,
  } = useTableSort<VersionSort>("version");
  const selectedRange =
    INSIGHTS_TIME_RANGES.find((range) => range.days === days) ??
    INSIGHTS_TIME_RANGES[2];

  const adoption = useQuery(adoptionQueryOptions(project.id, days));

  return (
    <InsightsPage
      title="Insights"
      description={
        <>
          Version adoption and client traffic across the API,{" "}
          {selectedRange.description}.
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Adoption curve</CardTitle>
          <CardDescription>
            Requests per {days === 1 ? "hour" : "day"}, stacked by pinned
            client version.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {adoption.isLoading ? (
            <AdoptionChartSkeleton />
          ) : isTelemetryOffline(adoption.error) ? (
            <TelemetryOfflineState error={adoption.error} />
          ) : (
            <AdoptionChart rows={adoption.data ?? []} hourly={days === 1} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>
            Every known release version and its traffic in this window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VersionsTable
            projectId={project.id}
            days={days}
            sort={versionSort}
            direction={versionDirection}
            onSort={sortVersions}
          />
        </CardContent>
      </Card>
    </InsightsPage>
  );
}
