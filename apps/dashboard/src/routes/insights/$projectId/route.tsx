import { Outlet, createFileRoute } from "@tanstack/react-router";

import { ChatLauncher } from "@/components/chat/chat-launcher";
import { NoProjectCard } from "@/components/insights/no-project-card";
import {
  INSIGHTS_TIME_RANGES,
  parseInsightsTimeRangeDays,
} from "@/components/insights/time-range-control";
import { VersionDetailsSheet } from "@/components/insights/version-details-sheet";
import Loader from "@/components/loader";
import { InsightsContext } from "@/hooks/use-insights-context";
import { useInsightsSheetNavigation } from "@/hooks/use-insights-sheet-navigation";
import { useInsightsTimeRange } from "@/hooks/use-insights-time-range";
import { useTelemetryProject } from "@/hooks/use-telemetry-project";

export const Route = createFileRoute("/insights/$projectId")({
  validateSearch: (search: Record<string, unknown>) => {
    const days =
      typeof search.days === "string" ? Number(search.days) : search.days;
    return {
      ...(INSIGHTS_TIME_RANGES.some((range) => range.days === days)
        ? { days: parseInsightsTimeRangeDays(days) }
        : {}),
      ...(typeof search.version === "string" && search.version.length > 0
        ? { version: search.version }
        : {}),
      ...(typeof search.error === "string" && search.error.length > 0
        ? { error: search.error }
        : {}),
    };
  },
  component: InsightsLayout,
});

function InsightsLayout() {
  const { user, teams, projectsLoading, telemetryProject } =
    useTelemetryProject();
  const [days, setDays] = useInsightsTimeRange();
  const search = Route.useSearch();
  const { closeVersion } = useInsightsSheetNavigation();

  if (projectsLoading) return <Loader />;
  if (!telemetryProject) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-4">
        <NoProjectCard />
      </div>
    );
  }

  return (
    <InsightsContext.Provider
      value={{
        user,
        teams,
        project: telemetryProject,
        days,
        setDays,
      }}
    >
      <Outlet />
      <VersionDetailsSheet
        days={days}
        onClose={closeVersion}
        projectId={telemetryProject.id}
        version={search.version ?? null}
      />
      {/* Inside the provider so the assistant always has a project scope. */}
      <ChatLauncher />
    </InsightsContext.Provider>
  );
}
