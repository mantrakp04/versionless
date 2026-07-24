export interface SeedTeam {
  id: string;
  displayName: string;
}

export interface ResolveSeedTeamOptions {
  demoApiKey?: string;
  explicitTeamId?: string;
  resolveApiKeyTeam?: (apiKey: string) => Promise<SeedTeam | null>;
}

export type SeedTeamResolution =
  | { teamId: string; source: "explicit" | "fallback" }
  | {
      teamId: string;
      source: "demo-api-key";
      team: SeedTeam;
    };

/**
 * Resolves a stable owner for preview data.
 *
 * The demo API key is authoritative when present: Hexclave resolves it to the
 * same team that owns real apps/demo telemetry. SEED_TEAM_ID remains a local
 * trusted-Collector fallback only.
 */
export async function resolveSeedTeam({
  demoApiKey,
  explicitTeamId,
  resolveApiKeyTeam,
}: ResolveSeedTeamOptions): Promise<SeedTeamResolution> {
  if (demoApiKey) {
    if (!resolveApiKeyTeam) {
      throw new Error(
        "DEMO_VERSIONLESS_API_KEY is set but Hexclave server credentials are unavailable",
      );
    }
    const team = await resolveApiKeyTeam(demoApiKey);
    if (!team) {
      throw new Error("DEMO_VERSIONLESS_API_KEY is not owned by a Hexclave team");
    }
    return {
      teamId: team.id,
      source: "demo-api-key",
      team,
    };
  }
  if (explicitTeamId) {
    return { teamId: explicitTeamId, source: "explicit" };
  }
  return { teamId: "demo", source: "fallback" };
}
