export interface SeedTeam {
  id: string;
  displayName: string;
}

export interface SeedUser {
  primaryEmail?: string | null;
  /**
   * Present on Hexclave users, but deliberately not used for seed ownership.
   * A dashboard team switch must not move the demo project between teams.
   */
  selectedTeam?: SeedTeam | null;
  listTeams(): Promise<readonly SeedTeam[]>;
}

export interface ResolveSeedTeamOptions {
  explicitTeamId?: string;
  adminEmail?: string;
  listUsers?: (email: string) => Promise<readonly SeedUser[]>;
}

export type SeedTeamResolution =
  | { teamId: string; source: "explicit" | "fallback" }
  | {
      teamId: string;
      source: "admin-account-first-team";
      email: string;
      team: SeedTeam;
    };

/**
 * Resolves a stable owner for preview data.
 *
 * The first team returned for SEED_ADMIN_ACCOUNT is intentionally used instead
 * of selectedTeam, because selectedTeam is mutable dashboard state.
 */
export async function resolveSeedTeam({
  explicitTeamId,
  adminEmail,
  listUsers,
}: ResolveSeedTeamOptions): Promise<SeedTeamResolution> {
  if (explicitTeamId) {
    return { teamId: explicitTeamId, source: "explicit" };
  }
  if (!adminEmail) {
    return { teamId: "demo", source: "fallback" };
  }
  if (!listUsers) {
    throw new Error(
      "SEED_ADMIN_ACCOUNT is set but HEXCLAVE_PROJECT_ID / HEXCLAVE_SECRET_SERVER_KEY are missing — the account lookup needs them",
    );
  }

  const users = await listUsers(adminEmail);
  const user = users.find(
    ({ primaryEmail }) =>
      primaryEmail?.toLowerCase() === adminEmail.toLowerCase(),
  );
  if (!user) {
    throw new Error(`No Hexclave user found for ${adminEmail}`);
  }

  const team = (await user.listTeams())[0];
  if (!team) {
    throw new Error(
      `Hexclave user ${adminEmail} has no teams — sign in to the dashboard once to create one`,
    );
  }

  return {
    teamId: team.id,
    source: "admin-account-first-team",
    email: adminEmail,
    team,
  };
}
