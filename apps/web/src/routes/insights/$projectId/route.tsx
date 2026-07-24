import { Outlet, createFileRoute } from "@tanstack/react-router";

import { NoProjectCard } from "@/components/insights/no-project-card";
import {
  INSIGHTS_TIME_RANGES,
  parseInsightsTimeRangeDays,
} from "@/components/insights/time-range-control";
import Loader from "@/components/loader";
import { InsightsContext } from "@/hooks/use-insights-context";
import { useInsightsTimeRange } from "@/hooks/use-insights-time-range";
import { useTelemetryProject } from "@/hooks/use-telemetry-project";

export const Route = createFileRoute("/insights/$projectId")({
  validateSearch: (search: Record<string, unknown>) => {
    const days =
      typeof search.days === "string" ? Number(search.days) : search.days;
    return INSIGHTS_TIME_RANGES.some((range) => range.days === days)
      ? { days: parseInsightsTimeRangeDays(days) }
      : {};
  },
  component: InsightsLayout,
});

function InsightsLayout() {
  const {
    user,
    teams,
    projectsLoading,
    telemetryProject,
  } = useTelemetryProject();
  const [days, setDays] = useInsightsTimeRange();

  if (projectsLoading) return <Loader />;
  if (!telemetryProject) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-6">
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
    </InsightsContext.Provider>
  );
}
