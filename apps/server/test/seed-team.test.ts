import { describe, expect, test } from "bun:test";
import {
  resolveSeedTeam,
  type SeedUser,
} from "../src/seed-team";

describe("resolveSeedTeam", () => {
  test("keeps SEED_TEAM_ID as the explicit override", async () => {
    let lookedUpAccount = false;

    const resolution = await resolveSeedTeam({
      explicitTeamId: "team-explicit",
      adminEmail: "owner@example.com",
      listUsers: async () => {
        lookedUpAccount = true;
        return [];
      },
    });

    expect(resolution).toEqual({
      teamId: "team-explicit",
      source: "explicit",
    });
    expect(lookedUpAccount).toBe(false);
  });

  test("always uses the account's first team after selectedTeam changes", async () => {
    const user: SeedUser = {
      primaryEmail: "owner@example.com",
      selectedTeam: {
        id: "team-selected-later",
        displayName: "Selected later",
      },
      listTeams: async () => [
        { id: "team-original", displayName: "Original team" },
        { id: "team-selected-later", displayName: "Selected later" },
      ],
    };

    const resolution = await resolveSeedTeam({
      adminEmail: "OWNER@example.com",
      listUsers: async () => [user],
    });

    expect(resolution).toEqual({
      teamId: "team-original",
      source: "admin-account-first-team",
      email: "OWNER@example.com",
      team: { id: "team-original", displayName: "Original team" },
    });
  });

  test("uses the hidden demo owner when no seed account is configured", async () => {
    expect(await resolveSeedTeam({})).toEqual({
      teamId: "demo",
      source: "fallback",
    });
  });
});
