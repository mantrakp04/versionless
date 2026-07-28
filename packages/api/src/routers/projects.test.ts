import { describe, expect, test } from "bun:test";

import {
  listProjectsForTeam,
  listProjectVersionDetails,
  loadProjectReleases,
  summarizeProjectVersion,
} from "./projects";
import { requireProjectAccess, requireTeamAccess } from "../lib/project-access";

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

describe("project version details", () => {
  const uploadedVersion = {
    id: "00000000-0000-4000-8000-000000000010",
    projectId: selectedProject.id,
    version: "2026-07-24",
    integrityHash: "a4063873",
    createdAt: new Date("2026-07-24T20:15:00.000Z"),
    snapshot: {
      formatVersion: 1,
      version: "2026-07-24",
      tool: "@versionless/cli@0.0.1",
      endpoints: {
        "GET /users/:id": { transport: "http", method: "GET" },
        "POST /users": {
          transport: "http",
          method: "POST",
          path: "/users",
          body: { kind: "object", fields: { email: {} } },
          responses: { "201": { kind: "ref", name: "User" } },
        },
        "trpc:projects.list": {
          transport: "trpc",
          procedure: "projects.list",
          procedureType: "query",
          input: { kind: "object", fields: { teamId: {} } },
          output: { kind: "array", items: { kind: "ref", name: "Project" } },
        },
      },
      models: {
        User: {
          kind: "object",
          fields: { id: {}, email: {}, displayName: {} },
        },
      },
      provenance: {
        repo: "acme/billing",
        ref: "main",
        sha: "0123456789abcdef",
      },
    },
  };

  test("derives allowlisted contract statistics from the uploaded config", () => {
    expect(summarizeProjectVersion(uploadedVersion)).toEqual({
      id: uploadedVersion.id,
      version: "2026-07-24",
      uploadedAt: "2026-07-24T20:15:00.000Z",
      tool: "@versionless/cli@0.0.1",
      integrityHash: "a4063873",
      endpointCount: 3,
      modelCount: 1,
      schemaFieldCount: 3,
      httpRouteCount: 2,
      procedureCount: 1,
      methods: [
        { method: "GET", count: 1 },
        { method: "POST", count: 1 },
      ],
      endpoints: ["GET /users/:id", "POST /users", "trpc:projects.list"],
      endpointDetails: [
        {
          id: "GET /users/:id",
          transport: "http",
          method: "GET",
          path: null,
          procedure: null,
          procedureType: null,
          requestFieldCount: 0,
          responseVariantCount: 0,
        },
        {
          id: "POST /users",
          transport: "http",
          method: "POST",
          path: "/users",
          procedure: null,
          procedureType: null,
          requestFieldCount: 1,
          responseVariantCount: 1,
        },
        {
          id: "trpc:projects.list",
          transport: "trpc",
          method: null,
          path: null,
          procedure: "projects.list",
          procedureType: "query",
          requestFieldCount: 1,
          responseVariantCount: 1,
        },
      ],
      models: ["User"],
      provenance: {
        repo: "acme/billing",
        ref: "main",
        sha: "0123456789abcdef",
      },
    });
  });

  test("authorizes the project before loading its version artifacts", async () => {
    const loadedProjectIds: string[] = [];
    const result = await listProjectVersionDetails(
      {
        getTeam: async (teamId) =>
          teamId === selectedProject.teamId ? { id: teamId } : null,
      },
      selectedProject.id,
      async (projectId) => {
        loadedProjectIds.push(projectId);
        return [uploadedVersion];
      },
      async () => ({
        project: selectedProject,
        team: { id: selectedProject.teamId },
      }),
    );

    expect(loadedProjectIds).toEqual([selectedProject.id]);
    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBe("2026-07-24");
    expect(result[0]).not.toHaveProperty("snapshot");
  });
});

describe("loadProjectReleases", () => {
  const allow = async () => ({
    project: selectedProject,
    team: { id: selectedProject.teamId },
  });
  const user = {
    getTeam: async (teamId: string) =>
      teamId === selectedProject.teamId ? { id: teamId } : null,
  };

  const version = (value: string) => ({
    id: `v-${value}`,
    projectId: selectedProject.id,
    version: value,
    integrityHash: "a4063873",
    createdAt: new Date("2026-07-24T20:15:00.000Z"),
    snapshot: { formatVersion: 1, version: value, endpoints: {}, models: {} },
  });

  test("reports the newest uploaded version and the declared schedule", async () => {
    const result = await loadProjectReleases(
      user,
      selectedProject.id,
      // Deliberately out of order — upload order is not version order.
      async () => [version("2026-07-24"), version("2025-06-01")] as never,
      async () => [
        {
          id: "s1",
          projectId: selectedProject.id,
          version: "2025-06-01",
          after: "2026-09-30",
          message: "Upgrade.",
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
      allow,
    );

    expect(result).toEqual({
      versions: ["2025-06-01", "2026-07-24"],
      current: "2026-07-24",
      sunsets: [
        { version: "2025-06-01", after: "2026-09-30", message: "Upgrade." },
      ],
    });
  });

  test("reports current as null when the project has never uploaded", async () => {
    // The dashboard must be able to say "no declared contract" rather than
    // silently promote whatever version happens to be busiest in traffic.
    expect(
      await loadProjectReleases(
        user,
        selectedProject.id,
        async () => [],
        async () => [],
        allow,
      ),
    ).toEqual({ versions: [], current: null, sunsets: [] });
  });

  test("authorizes the project before loading anything", async () => {
    let didLoad = false;
    await expect(
      loadProjectReleases(
        { getTeam: async () => null },
        selectedProject.id,
        async () => {
          didLoad = true;
          return [];
        },
        async () => {
          didLoad = true;
          return [];
        },
        async () => {
          throw Object.assign(new Error("forbidden"), { code: "FORBIDDEN" });
        },
      ),
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
    const listError = await listProjectsForTeam(
      denied,
      "team-other",
      async () => [],
    ).catch((error: unknown) => error);
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
