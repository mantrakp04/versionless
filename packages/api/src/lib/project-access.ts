import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "@versionless/db";
import { projects } from "@versionless/db/schema/projects";

export type ProjectAccessUser = {
  getTeam(teamId: string): Promise<{ id: string } | null>;
};

type ProjectLoader = (projectId: string) => Promise<
  typeof projects.$inferSelect | null
>;

async function loadProject(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project ?? null;
}

/**
 * Proves that the current user belongs to the team and returns the trusted
 * team. The single home of the team-membership denial contract.
 */
export async function requireTeamAccess(
  user: ProjectAccessUser,
  teamId: string,
) {
  const team = await user.getTeam(teamId);
  if (!team) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this team",
    });
  }
  return team;
}

/** Resolves a project and proves that the current user belongs to its team. */
export async function requireProjectAccess(
  user: ProjectAccessUser,
  projectId: string,
  load: ProjectLoader = loadProject,
) {
  const project = await load(projectId);
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }
  const team = await requireTeamAccess(user, project.teamId);
  return { project, team };
}
