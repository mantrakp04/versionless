import { and, eq, notInArray } from "drizzle-orm";
import { publicQueryHttpError } from "@versionless/api/error-policy";
import { fnv1a, stableStringify } from "@versionless/core";
import { db } from "@versionless/db";
import { projectSunsets, projectVersions } from "@versionless/db/schema/projects";
import { Elysia } from "elysia";

import type { OtlpAuthorization } from "./ingest";

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SUNSETS = 64;
const MAX_SUNSET_MESSAGE = 512;

export interface SnapshotSunset {
  version: string;
  after: string;
  message?: string;
}

interface VersionSnapshot {
  formatVersion: 1;
  version: string;
  tool: string;
  models: Record<string, unknown>;
  endpoints: Record<string, unknown>;
  integrity: {
    algo: "fnv1a-32";
    hash: string;
  };
  /**
   * Absent on snapshots from a CLI that predates sunset upload, and on
   * snapshots whose entry exports no instance. Absent means "unknown" and
   * leaves the stored schedule alone; `[]` means "this project declares none"
   * and clears it.
   */
  sunsets?: SnapshotSunset[];
  [key: string]: unknown;
}

export type SaveVersionResult = "created" | "unchanged" | "conflict";

export interface VersionUploadDependencies {
  authorize(
    authorization: string | undefined,
    projectName: string | undefined,
  ): Promise<OtlpAuthorization | null>;
  save(
    projectId: string,
    snapshot: VersionSnapshot,
  ): Promise<SaveVersionResult>;
  reportError?(error: unknown, projectName: string | undefined): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotHash(snapshot: VersionSnapshot): string {
  const {
    integrity: _integrity,
    provenance: _provenance,
    sunsets: _sunsets,
    ...content
  } = snapshot;
  return fnv1a(stableStringify(content));
}

/**
 * Returns the declared schedule, or `null` when the field is absent OR
 * malformed. Both cases mean "leave the stored schedule alone" — a snapshot
 * from an older CLI must not silently clear a project's retirement dates, and
 * neither must one whose sunsets array we cannot trust.
 */
export function parseSnapshotSunsets(value: unknown): SnapshotSunset[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_SUNSETS) return null;
  const parsed: SnapshotSunset[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const { version, after, message } = entry;
    if (
      typeof version !== "string" ||
      !VERSION_PATTERN.test(version) ||
      typeof after !== "string" ||
      !DATE_PATTERN.test(after) ||
      Number.isNaN(Date.parse(`${after}T00:00:00Z`)) ||
      (message !== undefined &&
        (typeof message !== "string" || message.length > MAX_SUNSET_MESSAGE))
    ) {
      return null;
    }
    // The unique index would reject a duplicate mid-transaction; rejecting the
    // whole payload here keeps the failure a 400 rather than a 500.
    if (seen.has(version)) return null;
    seen.add(version);
    parsed.push({ version, after, ...(message ? { message } : {}) });
  }
  return parsed;
}

export function parseVersionSnapshot(value: unknown): VersionSnapshot | null {
  if (!isRecord(value)) return null;
  const integrity = value.integrity;
  if (
    value.formatVersion !== 1 ||
    typeof value.version !== "string" ||
    !VERSION_PATTERN.test(value.version) ||
    typeof value.tool !== "string" ||
    !isRecord(value.models) ||
    !isRecord(value.endpoints) ||
    !isRecord(integrity) ||
    integrity.algo !== "fnv1a-32" ||
    typeof integrity.hash !== "string" ||
    !/^[a-f0-9]{8}$/.test(integrity.hash)
  ) {
    return null;
  }
  if (JSON.stringify(value).length > MAX_SNAPSHOT_BYTES) return null;
  const snapshot = value as VersionSnapshot;
  return snapshot.integrity.hash === snapshotHash(snapshot) ? snapshot : null;
}

/**
 * Replaces the project's sunset schedule with the uploaded declaration. The
 * customer's code is the source of truth, so a version removed from
 * `v.sunset(...)` must disappear here too — but only when the snapshot
 * actually carries the field.
 */
export async function saveProjectSunsets(
  projectId: string,
  sunsets: SnapshotSunset[],
): Promise<void> {
  await db.transaction(async (tx) => {
    if (sunsets.length === 0) {
      await tx
        .delete(projectSunsets)
        .where(eq(projectSunsets.projectId, projectId));
      return;
    }
    await tx
      .delete(projectSunsets)
      .where(
        and(
          eq(projectSunsets.projectId, projectId),
          notInArray(
            projectSunsets.version,
            sunsets.map((sunset) => sunset.version),
          ),
        ),
      );
    for (const sunset of sunsets) {
      await tx
        .insert(projectSunsets)
        .values({
          projectId,
          version: sunset.version,
          after: sunset.after,
          message: sunset.message ?? null,
        })
        .onConflictDoUpdate({
          target: [projectSunsets.projectId, projectSunsets.version],
          set: {
            after: sunset.after,
            message: sunset.message ?? null,
            updatedAt: new Date(),
          },
        });
    }
  });
}

export async function saveProjectVersion(
  projectId: string,
  snapshot: VersionSnapshot,
): Promise<SaveVersionResult> {
  // Sunsets are project-level and excluded from the integrity hash, so they
  // persist even when the surface itself is "unchanged" or in "conflict" —
  // pushing back a retirement date must not require a new version.
  const sunsets = parseSnapshotSunsets(snapshot.sunsets);
  if (sunsets) await saveProjectSunsets(projectId, sunsets);

  const [created] = await db
    .insert(projectVersions)
    .values({
      projectId,
      version: snapshot.version,
      integrityHash: snapshot.integrity.hash,
      snapshot,
    })
    .onConflictDoNothing({
      target: [projectVersions.projectId, projectVersions.version],
    })
    .returning({ id: projectVersions.id });
  if (created) return "created";

  const [existing] = await db
    .select({ integrityHash: projectVersions.integrityHash })
    .from(projectVersions)
    .where(
      and(
        eq(projectVersions.projectId, projectId),
        eq(projectVersions.version, snapshot.version),
      ),
    )
    .limit(1);
  return existing?.integrityHash === snapshot.integrity.hash
    ? "unchanged"
    : "conflict";
}

export function createVersionUploadApp(
  dependencies: VersionUploadDependencies,
) {
  return new Elysia({ name: "versionless-version-upload" }).post(
    "/v1/versions",
    async ({ body, headers, set }) => {
      const projectName = headers["x-versionless-project"];
      try {
        const identity = await dependencies.authorize(
          headers.authorization,
          projectName,
        );
        if (!identity) {
          set.status = 401;
          return { error: "The API key cannot upload this version." };
        }

        const snapshot = parseVersionSnapshot(body);
        if (!snapshot) {
          set.status = 400;
          return { error: "The generated version file is invalid." };
        }

        const result = await dependencies.save(identity.projectId, snapshot);
        if (result === "conflict") {
          set.status = 409;
          return {
            error:
              "That project version already exists with a different API surface.",
          };
        }
        set.status = result === "created" ? 201 : 200;
        return {
          projectId: identity.projectId,
          version: snapshot.version,
          created: result === "created",
        };
      } catch (error) {
        dependencies.reportError?.(error, projectName);
        const publicError = publicQueryHttpError(error);
        set.status = publicError.status;
        return { error: publicError.message };
      }
    },
  );
}
