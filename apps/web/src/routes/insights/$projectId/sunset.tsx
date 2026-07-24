import { useMemo, useState } from "react";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@versionless/ui/components/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@versionless/ui/components/select";
import { CircleCheck } from "lucide-react";

import { BlockersTable } from "@/components/insights/blockers-table";
import { InsightsPage } from "@/components/insights/insights-page";
import { OfflineCard, isTelemetryOffline } from "@/components/insights/offline-card";
import { useTableSort } from "@/components/insights/sortable-table-head";
import Loader from "@/components/loader";
import { useInsightsContext } from "@/hooks/use-insights-context";
import {
  sunsetBlockersQueryOptions,
  versionsQueryOptions,
  type SunsetBlockerSort,
} from "@/queries/insights";

export const Route = createFileRoute("/insights/$projectId/sunset")({
  component: SunsetPage,
});

function SunsetPage() {
  const { project } = useInsightsContext();

  const versions = useQuery(versionsQueryOptions(project.id));

  // Sunset-scheduled versions plus anything that is not the newest release.
  // The versions query returns versions sorted descending, so index 0 is newest.
  const candidates = useMemo(
    () =>
      (versions.data ?? []).filter(
        (v, index) => v.sunsetAfter !== null || index > 0,
      ),
    [versions.data],
  );
  const oldest = candidates.at(-1)?.version;

  const [selected, setSelected] = useState<string | null>(null);
  const version = selected ?? oldest ?? null;
  const {
    sort: blockerSort,
    direction: blockerDirection,
    toggleSort: sortBlockers,
  } = useTableSort<SunsetBlockerSort>("requests");

  const blockers = useQuery({
    ...sunsetBlockersQueryOptions({
      version: version ?? "",
      projectId: project.id,
      sort: blockerSort,
      direction: blockerDirection,
    }),
    enabled: version !== null,
  });

  const offline =
    isTelemetryOffline(versions.error) || isTelemetryOffline(blockers.error);
  const offlineError = isTelemetryOffline(versions.error)
    ? versions.error
    : blockers.error;

  return (
    <InsightsPage
      title="Can I sunset?"
      description="Pick a version to see which consumers would break if you removed it today."
      showTimeRange={false}
    >
      {offline ? (
        <OfflineCard error={offlineError} />
      ) : versions.isLoading ? (
        <Loader />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Sunset blockers</CardTitle>
            <CardDescription>
              Consumers with traffic on or below the selected version in the
              last 30 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              value={version}
              onValueChange={(value) => setSelected(value as string)}
            >
              <SelectTrigger className="w-44 font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.version} value={candidate.version}>
                    <span className="font-mono">{candidate.version}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {version === null ? (
              <p className="text-xs text-muted-foreground">
                No sunset candidates — every known version is current.
              </p>
            ) : blockers.isLoading ? (
              <Loader />
            ) : (blockers.data?.length ?? 0) === 0 ? (
              <Empty className="border border-dashed border-green-500/40 bg-green-500/5">
                <EmptyHeader>
                  <EmptyMedia variant="icon" className="bg-green-500/10">
                    <CircleCheck className="text-green-600 dark:text-green-400" />
                  </EmptyMedia>
                  <EmptyTitle className="text-green-600 dark:text-green-400">
                    Safe to sunset {version}
                  </EmptyTitle>
                  <EmptyDescription>No traffic in 30 days</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <BlockersTable
                blockers={blockers.data ?? []}
                sort={blockerSort}
                direction={blockerDirection}
                onSort={sortBlockers}
              />
            )}
          </CardContent>
        </Card>
      )}
    </InsightsPage>
  );
}
