import { Card, CardContent } from "@versionless/ui/components/card";

import { InsightsPage } from "@/components/insights/insights-page";
import { useTableSort } from "@/components/insights/sortable-table-head";
import {
  defaultVersionSortDirection,
  VersionsTable,
} from "@/components/insights/versions-table";
import { useInsightsContext } from "@/hooks/use-insights-context";
import { useInsightsSheetNavigation } from "@/hooks/use-insights-sheet-navigation";
import type { VersionSort } from "@/queries/insights";

export function VersionsPage() {
  const { project, days } = useInsightsContext();
  const { openVersion } = useInsightsSheetNavigation();
  const { sort, direction, toggleSort } = useTableSort<VersionSort>(
    "version",
    defaultVersionSortDirection,
  );

  return (
    <InsightsPage title="Versions">
      <Card className="overflow-visible py-2">
        <CardContent className="px-2">
          <VersionsTable
            projectId={project.id}
            days={days}
            sort={sort}
            direction={direction}
            onSort={toggleSort}
            onVersionClick={openVersion}
          />
        </CardContent>
      </Card>
    </InsightsPage>
  );
}
