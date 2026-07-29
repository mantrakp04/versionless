import { useQuery } from "@tanstack/react-query";

import type { ProjectRelease } from "@/queries/insights";
import { trpc } from "@/utils/trpc";

export interface ProjectReleases {
  /** Versions with an uploaded contract, ascending. Empty until a snapshot. */
  versions: readonly string[];
  sunsets: readonly ProjectRelease[];
  /**
   * Newest uploaded version, or `null` when the project has never run
   * `versionless snapshot`. Callers that need a "current version" must fall
   * back to traffic explicitly and label the fallback — the newest version
   * clients ask for is not the same as the newest version the API declares.
   */
  current: string | null;
  /** False while loading or when the project has uploaded no snapshots. */
  declared: boolean;
}

const EMPTY: ProjectReleases = {
  versions: [],
  sunsets: [],
  current: null,
  declared: false,
};

/**
 * Release metadata as declared by the customer's own `versionless.config.ts`
 * and uploaded by `versionless snapshot`. Before this existed the dashboard
 * read the demo app's hardcoded constants, which meant every project rendered
 * the demo's sunset dates.
 */
export function useProjectReleases(projectId: string) {
  const query = useQuery({
    ...trpc.projects.releases.queryOptions({ projectId }),
    enabled: projectId !== "",
    staleTime: 60_000,
  });

  return {
    ...(query.data
      ? {
          versions: query.data.versions,
          sunsets: query.data.sunsets,
          current: query.data.current,
          declared: query.data.current !== null,
        }
      : EMPTY),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
