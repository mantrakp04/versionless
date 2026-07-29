import { createFileRoute } from "@tanstack/react-router";

import { ErrorOverview } from "@/components/insights/error-overview";
import { InsightsPage } from "@/components/insights/insights-page";
import { OverviewReport } from "@/components/insights/overview-report";
import { useInsightsContext } from "@/hooks/use-insights-context";
import { useInsightsSheetNavigation } from "@/hooks/use-insights-sheet-navigation";

export const Route = createFileRoute("/insights/$projectId/")({
  component: InsightsOverview,
});

function InsightsOverview() {
  const { project, days } = useInsightsContext();
  const search = Route.useSearch();
  const { closeError, openError, openVersion } = useInsightsSheetNavigation();

  return (
    <InsightsPage title="Insights">
      <OverviewReport
        afterHealth={
          <ErrorOverview
            days={days}
            onErrorChange={(error) =>
              error === undefined ? closeError() : openError(error)
            }
            onVersionClick={openVersion}
            projectId={project.id}
            selectedErrorKey={search.error}
          />
        }
        days={days}
        onVersionClick={openVersion}
        projectId={project.id}
      />
    </InsightsPage>
  );
}
