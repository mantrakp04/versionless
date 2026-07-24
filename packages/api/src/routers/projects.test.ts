import { describe, expect, test } from "bun:test";

import { listProjectsForTeam } from "./projects";
import {
  requireProjectAccess,
  requireTeamAccess,
} from "../lib/project-access";

const selectedProject = {
  id: "00000000-0000-0000-0000-000000000001",
  teamId: "team-selected",
  name: "billing-api",
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
  lastSeenAt: new Date("2026-07-23T00:00:00.000Z"),
};

describe("listProjectsForTeam", () => {
  test("loads projects only for a team the current user belongs to", async () => {
    const loadedTeamIds: string[] = [];
    const user = {
      getTeam: async (teamId: string) =>
        teamId === "team-selected" ? { id: teamId } : null,
    };

    const result = await listProjectsForTeam(
      user,
      "team-selected",
      async (teamId) => {
        loadedTeamIds.push(teamId);
        return [selectedProject];
      },
    );

    expect(loadedTeamIds).toEqual(["team-selected"]);
    expect(result).toEqual([selectedProject]);
  });

  test("rejects a team the current user does not belong to before loading", async () => {
    let didLoad = false;
    const user = {
      getTeam: async () => null,
    };

    await expect(
      listProjectsForTeam(user, "team-other", async () => {
        didLoad = true;
        return [];
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(didLoad).toBe(false);
  });
});

describe("requireProjectAccess", () => {
  test("returns the trusted project only after team membership succeeds", async () => {
    const access = await requireProjectAccess(
      {
        getTeam: async (teamId) =>
          teamId === selectedProject.teamId ? { id: teamId } : null,
      },
      selectedProject.id,
      async () => selectedProject,
    );
    expect(access).toEqual({
      project: selectedProject,
      team: { id: selectedProject.teamId },
    });
  });

  test("rejects an unknown project before checking team membership", async () => {
    let checkedMembership = false;
    await expect(
      requireProjectAccess(
        {
          getTeam: async () => {
            checkedMembership = true;
            return { id: "team-selected" };
          },
        },
        "00000000-0000-0000-0000-00000000dead",
        async () => null,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(checkedMembership).toBe(false);
  });

  test("rejects a project whose team the user does not belong to", async () => {
    await expect(
      requireProjectAccess(
        { getTeam: async () => null },
        selectedProject.id,
        async () => selectedProject,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requireTeamAccess", () => {
  test("returns the trusted team for a member", async () => {
    const team = await requireTeamAccess(
      {
        getTeam: async (teamId) =>
          teamId === "team-selected" ? { id: teamId } : null,
      },
      "team-selected",
    );
    expect(team).toEqual({ id: "team-selected" });
  });

  test("shares one denial contract between the team and project guards", async () => {
    const denied = { getTeam: async () => null };
    const teamError = await requireTeamAccess(denied, "team-other").catch(
      (error: unknown) => error,
    );
    const listError = await listProjectsForTeam(denied, "team-other", async () => [])
      .catch((error: unknown) => error);
    const projectError = await requireProjectAccess(
      denied,
      selectedProject.id,
      async () => selectedProject,
    ).catch((error: unknown) => error);

    for (const error of [teamError, listError, projectError]) {
      expect(error).toMatchObject({
        code: "FORBIDDEN",
        message: "You do not have access to this team",
      });
    }
  });
});
