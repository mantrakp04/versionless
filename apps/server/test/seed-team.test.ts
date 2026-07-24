import { describe, expect, test } from "bun:test";
import { resolveSeedTeam } from "../src/seed-team";

describe("resolveSeedTeam", () => {
  test("uses the demo API key owner even when a stale team override exists", async () => {
    let resolvedKey: string | undefined;

    const resolution = await resolveSeedTeam({
      demoApiKey: "demo-api-key",
      explicitTeamId: "mantra-team",
      resolveApiKeyTeam: async (apiKey) => {
        resolvedKey = apiKey;
        return { id: "demo-team", displayName: "demo" };
      },
    });

    expect(resolution).toEqual({
      teamId: "demo-team",
      source: "demo-api-key",
      team: { id: "demo-team", displayName: "demo" },
    });
    expect(resolvedKey).toBe("demo-api-key");
  });

  test("keeps SEED_TEAM_ID as the trusted local-Collector override", async () => {
    expect(
      await resolveSeedTeam({ explicitTeamId: "team-explicit" }),
    ).toEqual({
      teamId: "team-explicit",
      source: "explicit",
    });
  });

  test("uses the hidden demo owner when no seed account is configured", async () => {
    expect(await resolveSeedTeam({})).toEqual({
      teamId: "demo",
      source: "fallback",
    });
  });
});
