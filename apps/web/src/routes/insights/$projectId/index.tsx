import { createFileRoute } from "@tanstack/react-router";

import { ErrorOverview } from "@/components/insights/error-overview";
import { InsightsPage } from "@/components/insights/insights-page";
import { OverviewReport } from "@/components/insights/overview-report";
import { useInsightsContext } from "@/hooks/use-insights-context";
import { useInsightsSheetNavigation } from "@/hooks/use-insights-sheet-navigation";

export const Route = createFileRoute("/insights/$projectId/")({
  component: InsightsOverview,
});

/**
 * The overview answers nine questions in one pass, then hands off to the error
 * list — which stays last because it is a drill-down into the reliability
 * reading above it, not a tenth question.
 */
function InsightsOverview() {
  const { project, days } = useInsightsContext();
  const search = Route.useSearch();
  const { closeError, openError, openVersion } = useInsightsSheetNavigation();

  return (
    <InsightsPage title="Insights" maxWidth="6xl">
      <OverviewReport
        days={days}
        onVersionClick={openVersion}
        projectId={project.id}
      />
      <ErrorOverview
        days={days}
        onErrorChange={(error) =>
          error === undefined ? closeError() : openError(error)
        }
        onVersionClick={openVersion}
        projectId={project.id}
        selectedErrorKey={search.error}
      />
    </InsightsPage>
  );
}
