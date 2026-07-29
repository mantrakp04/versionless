import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@versionless/ui/components/card";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { ArrowUpRight, Boxes } from "lucide-react";

import { DashboardList } from "@/components/dashboard-list";
import { useSelectedTeam } from "@/hooks/use-selected-team";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="h-full">
      <div className="container mx-auto max-w-6xl space-y-6 px-4 py-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-xl font-medium">Projects</h1>
        </header>

        <Suspense
          fallback={
            <div
              aria-busy="true"
              aria-label="Loading projects"
              className="grid gap-3 sm:grid-cols-2"
              role="status"
            >
              <ProjectCardSkeleton />
              <ProjectCardSkeleton />
              <span className="sr-only">Loading projects</span>
            </div>
          }
        >
          <SignedInProjects />
        </Suspense>
      </div>
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="size-4 rounded-sm" />
        </div>
        <div className="space-y-2 pt-3">
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-3 w-16" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-3 w-36" />
      </CardContent>
    </Card>
  );
}

function SignedInProjects() {
  const { teams, selectedTeam } = useSelectedTeam();
  const projects = useQuery(
    trpc.projects.list.queryOptions(
      { teamId: selectedTeam?.id ?? "" },
      { enabled: selectedTeam !== null },
    ),
  );
  const teamById = new Map(teams.map((team) => [team.id, team]));

  return (
    <DashboardList
      className="rounded-lg"
      contentClassName="grid gap-3 divide-y-0 sm:grid-cols-2"
      emptyState={
        <Card className="border-dashed text-left">
          <CardHeader>
            <CardTitle>No telemetry projects yet</CardTitle>
            <CardDescription>
              Add a project name and API key to{" "}
              <code className="font-mono">createVersionless</code>. The first
              telemetry batch creates the project automatically.
            </CardDescription>
          </CardHeader>
        </Card>
      }
      errorState="We could not load projects. Please try again."
      getItemKey={(project) => project.id}
      isError={projects.isError}
      isLoading={projects.isLoading}
      items={projects.data ?? []}
      renderItem={(project) => {
        const team = teamById.get(project.teamId);
        return (
          <Link
            to="/insights/$projectId"
            params={{ projectId: project.id }}
            className="group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors group-hover:bg-muted/35">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <span className="grid size-9 place-items-center rounded-md bg-muted">
                    <Boxes className="size-4" />
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <CardTitle className="pt-3">{project.name}</CardTitle>
                <CardDescription>
                  {team?.displayName ?? "Unknown account"}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                Last telemetry{" "}
                {new Date(project.lastSeenAt).toLocaleDateString()}
              </CardContent>
            </Card>
          </Link>
        );
      }}
      skeleton={{
        contentClassName: "grid gap-3 divide-y-0 sm:grid-cols-2",
        renderItem: () => <ProjectCardSkeleton />,
        rowHeight: 163,
        rows: 1,
      }}
    />
  );
}
