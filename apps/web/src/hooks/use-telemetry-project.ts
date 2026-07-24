import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { useSelectedTeam } from "@/hooks/use-selected-team";
import { trpc } from "@/utils/trpc";

const insightsRoute = getRouteApi("/insights/$projectId");

export function useTelemetryProject() {
  const { user, teams } = useSelectedTeam();
  const { projectId } = insightsRoute.useParams();
  // One lookup resolves the project across every team the user belongs to;
  // the per-team projects.list fan-out lives in the project switcher, the
  // only place the cross-team list is displayed.
  const projectQuery = useQuery(
    trpc.projects.byId.queryOptions({ projectId }),
  );
  const telemetryProject = projectQuery.data ?? null;

  useEffect(() => {
    if (
      telemetryProject &&
      telemetryProject.teamId !== user.selectedTeam?.id
    ) {
      void user.setSelectedTeam(telemetryProject.teamId);
    }
  }, [telemetryProject, user]);

  return {
    user,
    teams,
    projectsLoading: projectQuery.isLoading,
    telemetryProject,
  };
}
