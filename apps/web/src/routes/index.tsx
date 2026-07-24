import { Suspense } from "react";
import { useUser } from "@hexclave/react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@versionless/ui/components/card";
import { ArrowUpRight, Boxes } from "lucide-react";

import Loader from "@/components/loader";
import { useSelectedTeam } from "@/hooks/use-selected-team";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-5xl space-y-5 px-3 py-4">
        <header className="max-w-2xl">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Projects
          </h1>
        </header>

        <Suspense fallback={<Loader />}>
          <ProjectsSection />
        </Suspense>
      </div>
    </div>
  );
}

function ProjectsSection() {
  const user = useUser();

  if (!user) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Sign in to see your projects</CardTitle>
          <CardDescription>
            Projects are private to their teams.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <SignedInProjects />;
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

  if (projects.isLoading) return <Loader />;

  if (!projects.data?.length) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>No telemetry projects yet</CardTitle>
          <CardDescription>
            Add a project name and API key to{" "}
            <code className="font-mono">createVersionless</code>. The first
            telemetry batch creates the project automatically.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {projects.data.map((project) => {
        const team = teamById.get(project.teamId);
        return (
          <Link
            key={project.id}
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
      })}
    </section>
  );
}
