import { desc, eq } from "drizzle-orm";
import { db } from "@versionless/db";
import {
  projects,
  type Project,
} from "@versionless/db/schema/projects";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import {
  requireProjectAccess,
  requireTeamAccess,
  type ProjectAccessUser,
} from "../lib/project-access";

type ProjectLoader = (teamId: string) => Promise<Project[]>;

async function loadProjectsForTeam(teamId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(desc(projects.lastSeenAt));
}

export async function listProjectsForTeam(
  user: ProjectAccessUser,
  teamId: string,
  loadProjects: ProjectLoader = loadProjectsForTeam,
): Promise<Project[]> {
  // Projects are owned by teams. User membership is checked at request time,
  // so moving a user between teams never requires rewriting project rows.
  const team = await requireTeamAccess(user, teamId);
  return loadProjects(team.id);
}

export const projectsRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string().min(1) }))
    .query(({ ctx, input }) => listProjectsForTeam(ctx.user, input.teamId)),
  byId: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx.user,
        input.projectId,
      );
      return project;
    }),
});
