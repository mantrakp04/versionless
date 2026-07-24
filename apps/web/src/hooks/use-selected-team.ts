import { useUser } from "@hexclave/react";

/**
 * Resolves the active Hexclave team (the account that owns API keys).
 * Redirects signed-out visitors and falls back to the user's first team.
 */
export function useSelectedTeam() {
  const user = useUser({ or: "redirect" });
  const teams = user.useTeams();
  const selectedTeam = user.selectedTeam ?? teams[0] ?? null;
  return { user, teams, selectedTeam };
}
