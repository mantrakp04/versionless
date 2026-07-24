import { useQueries } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@versionless/ui/components/select";

import { preserveInsightsSearch } from "@/components/insights/insights-navigation";
import { useInsightsContext } from "@/hooks/use-insights-context";
import { trpc } from "@/utils/trpc";

export function projectRouteForPathname(pathname: string) {
  if (pathname.endsWith("/sunset")) return "/insights/$projectId/sunset" as const;
  if (pathname.endsWith("/drift")) return "/insights/$projectId/drift" as const;
  if (pathname.endsWith("/traces")) return "/insights/$projectId/traces" as const;
  if (pathname.endsWith("/telemetry"))
    return "/insights/$projectId/telemetry" as const;
  return "/insights/$projectId" as const;
}

export function ProjectSwitcher() {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { teams, project } = useInsightsContext();
  // The switcher is the only surface that shows every project across teams,
  // so the per-team fan-out lives here rather than in the insights layout.
  const projectQueries = useQueries({
    queries: teams.map((team) =>
      trpc.projects.list.queryOptions({ teamId: team.id }),
    ),
  });
  const projects = projectQueries.flatMap((query) => query.data ?? []);

  return (
    <Select
      value={project.id}
      onValueChange={(projectId) => {
        if (!projectId) return;
        void navigate({
          to: projectRouteForPathname(pathname),
          params: { projectId },
          search: preserveInsightsSearch,
        });
      }}
    >
      <SelectTrigger className="w-64">
        <SelectValue>
          {(projectId) =>
            projects.find((candidate) => candidate.id === projectId)?.name ??
            (projectId === project.id ? project.name : "Select project")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => {
          const teamProjects = projects.filter(
            (project) => project.teamId === team.id,
          );
          if (teamProjects.length === 0) return null;
          return (
            <SelectGroup key={team.id}>
              <SelectLabel>{team.displayName}</SelectLabel>
              {teamProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
