import { asc, desc, eq } from "drizzle-orm";
import { db } from "@versionless/db";
import {
  projects,
  projectSunsets,
  projectVersions,
  type Project,
  type ProjectSunset,
  type ProjectVersion,
} from "@versionless/db/schema/projects";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import {
  requireProjectAccess,
  requireTeamAccess,
  type ProjectAccessUser,
} from "../lib/project-access";

type ProjectLoader = (teamId: string) => Promise<Project[]>;
type ProjectVersionLoader = (projectId: string) => Promise<ProjectVersion[]>;
type ProjectReleaseVersion = Pick<ProjectVersion, "version">;
type ProjectReleaseVersionLoader = (
  projectId: string,
) => Promise<ProjectReleaseVersion[]>;
type ProjectReleaseSunset = Pick<
  ProjectSunset,
  "version" | "after" | "message"
>;
type ProjectSunsetLoader = (
  projectId: string,
) => Promise<ProjectReleaseSunset[]>;

async function loadProjectsForTeam(teamId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(desc(projects.lastSeenAt));
}

async function loadVersionsForProject(
  projectId: string,
): Promise<ProjectVersion[]> {
  return db
    .select()
    .from(projectVersions)
    .where(eq(projectVersions.projectId, projectId))
    .orderBy(desc(projectVersions.version));
}

async function loadReleaseVersionsForProject(
  projectId: string,
): Promise<ProjectReleaseVersion[]> {
  return db
    .select({ version: projectVersions.version })
    .from(projectVersions)
    .where(eq(projectVersions.projectId, projectId))
    .orderBy(desc(projectVersions.version));
}

async function loadSunsetsForProject(
  projectId: string,
): Promise<ProjectReleaseSunset[]> {
  return db
    .select({
      version: projectSunsets.version,
      after: projectSunsets.after,
      message: projectSunsets.message,
    })
    .from(projectSunsets)
    .where(eq(projectSunsets.projectId, projectId))
    .orderBy(asc(projectSunsets.version));
}

type SnapshotRecord = Record<string, unknown>;

function record(value: unknown): SnapshotRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SnapshotRecord)
    : null;
}

function stringsFromRecord(value: unknown): string[] {
  return Object.keys(record(value) ?? {}).sort();
}

export interface ProjectVersionDetail {
  id: string;
  version: string;
  uploadedAt: string;
  tool: string | null;
  integrityHash: string;
  endpointCount: number;
  modelCount: number;
  schemaFieldCount: number;
  httpRouteCount: number;
  procedureCount: number;
  methods: Array<{ method: string; count: number }>;
  endpoints: string[];
  endpointDetails: ProjectVersionEndpointDetail[];
  models: string[];
  provenance: {
    repo: string | null;
    ref: string | null;
    sha: string | null;
  } | null;
}

export interface ProjectVersionEndpointDetail {
  id: string;
  transport: "http" | "trpc" | "unknown";
  method: string | null;
  path: string | null;
  procedure: string | null;
  procedureType: string | null;
  requestFieldCount: number;
  responseVariantCount: number;
}

function fieldCount(value: unknown): number {
  return stringsFromRecord(record(value)?.fields).length;
}

function summarizeEndpoint(
  id: string,
  value: unknown,
): ProjectVersionEndpointDetail {
  const endpoint = record(value) ?? {};
  const transport =
    endpoint.transport === "http" || endpoint.transport === "trpc"
      ? endpoint.transport
      : "unknown";
  const requestFieldCount =
    transport === "http"
      ? fieldCount(endpoint.body) +
        fieldCount(endpoint.params) +
        fieldCount(endpoint.query)
      : fieldCount(endpoint.input);

  return {
    id,
    transport,
    method: typeof endpoint.method === "string" ? endpoint.method : null,
    path: typeof endpoint.path === "string" ? endpoint.path : null,
    procedure:
      typeof endpoint.procedure === "string" ? endpoint.procedure : null,
    procedureType:
      typeof endpoint.procedureType === "string"
        ? endpoint.procedureType
        : null,
    requestFieldCount,
    responseVariantCount:
      transport === "http"
        ? stringsFromRecord(endpoint.responses).length
        : endpoint.output === null || endpoint.output === undefined
          ? 0
          : 1,
  };
}

/**
 * Reduces the uploaded artifact to explicitly allowlisted contract metadata.
 * The dashboard never receives the raw JSONB snapshot.
 */
export function summarizeProjectVersion(
  row: ProjectVersion,
): ProjectVersionDetail {
  const snapshot = record(row.snapshot) ?? {};
  const endpointMap = record(snapshot.endpoints) ?? {};
  const modelMap = record(snapshot.models) ?? {};
  const methodCounts = new Map<string, number>();
  let httpRouteCount = 0;
  let procedureCount = 0;

  for (const endpoint of Object.values(endpointMap)) {
    const definition = record(endpoint);
    if (definition?.transport === "http") {
      httpRouteCount += 1;
      const method =
        typeof definition.method === "string"
          ? definition.method.toUpperCase()
          : "OTHER";
      methodCounts.set(method, (methodCounts.get(method) ?? 0) + 1);
    } else if (definition?.transport === "trpc") {
      procedureCount += 1;
    }
  }

  let schemaFieldCount = 0;
  for (const model of Object.values(modelMap)) {
    schemaFieldCount += stringsFromRecord(record(model)?.fields).length;
  }

  const provenance = record(snapshot.provenance);
  const safeProvenance = provenance
    ? {
        repo: typeof provenance.repo === "string" ? provenance.repo : null,
        ref: typeof provenance.ref === "string" ? provenance.ref : null,
        sha: typeof provenance.sha === "string" ? provenance.sha : null,
      }
    : null;

  return {
    id: row.id,
    version: row.version,
    uploadedAt: row.createdAt.toISOString(),
    tool: typeof snapshot.tool === "string" ? snapshot.tool : null,
    integrityHash: row.integrityHash,
    endpointCount: Object.keys(endpointMap).length,
    modelCount: Object.keys(modelMap).length,
    schemaFieldCount,
    httpRouteCount,
    procedureCount,
    methods: [...methodCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([method, count]) => ({ method, count })),
    endpoints: Object.keys(endpointMap).sort(),
    endpointDetails: Object.entries(endpointMap)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, endpoint]) => summarizeEndpoint(id, endpoint)),
    models: Object.keys(modelMap).sort(),
    provenance: safeProvenance,
  };
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

export interface ProjectSunsetDetail {
  version: string;
  after: string;
  message: string | null;
}

export interface ProjectReleases {
  /** Versions with an uploaded contract, ascending. */
  versions: string[];
  /**
   * Newest uploaded version, or `null` when the project has never run
   * `versionless snapshot`. Callers must not substitute the newest version
   * seen in traffic without saying so — traffic shows what clients ask for,
   * which is not the same as what the API declares.
   */
  current: string | null;
  sunsets: ProjectSunsetDetail[];
}

export async function loadProjectReleases(
  user: ProjectAccessUser,
  projectId: string,
  loadVersions: ProjectReleaseVersionLoader = loadReleaseVersionsForProject,
  loadSunsets: ProjectSunsetLoader = loadSunsetsForProject,
  authorizeProject: typeof requireProjectAccess = requireProjectAccess,
): Promise<ProjectReleases> {
  const { project } = await authorizeProject(user, projectId);
  const [versionRows, sunsetRows] = await Promise.all([
    loadVersions(project.id),
    loadSunsets(project.id),
  ]);
  const versions = versionRows
    .map((row) => row.version)
    .sort((left, right) => left.localeCompare(right));
  return {
    versions,
    current: versions.at(-1) ?? null,
    sunsets: sunsetRows.map((row) => ({
      version: row.version,
      after: row.after,
      message: row.message,
    })),
  };
}

export async function listProjectVersionDetails(
  user: ProjectAccessUser,
  projectId: string,
  loadVersions: ProjectVersionLoader = loadVersionsForProject,
  authorizeProject: typeof requireProjectAccess = requireProjectAccess,
): Promise<ProjectVersionDetail[]> {
  const { project } = await authorizeProject(user, projectId);
  const versions = await loadVersions(project.id);
  return versions.map(summarizeProjectVersion);
}

export const projectsRouter = router({
  list: protectedProcedure
    .input(z.object({ teamId: z.string().min(1) }))
    .query(({ ctx, input }) => listProjectsForTeam(ctx.user, input.teamId)),
  byId: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx.user, input.projectId);
      return project;
    }),
  versions: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      listProjectVersionDetails(ctx.user, input.projectId),
    ),
  releases: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ ctx, input }) => loadProjectReleases(ctx.user, input.projectId)),
});
