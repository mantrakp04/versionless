import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@versionless/db";
import {
  projects,
  telemetryIngestKeys,
} from "@versionless/db/schema/projects";
import { Elysia } from "elysia";

export function parseKeyRegistry(raw: string | undefined): Map<string, string> {
  const byId = new Map<string, string>();
  for (const key of (raw ?? "").split(",")) {
    const trimmed = key.trim();
    const parts = trimmed.split("_");
    if (parts.length >= 3 && parts[0] === "vl" && parts[1]) {
      byId.set(parts[1], trimmed);
    }
  }
  return byId;
}

export function configuredIngestKeys(
  raw: string | undefined,
  nodeEnv: "development" | "production" | "test",
): Map<string, string> {
  return parseKeyRegistry(
    raw ?? (nodeEnv === "development" ? "vl_demo_local-secret" : undefined),
  );
}

export function keyIdOf(fullKey: string): string | null {
  const parts = fullKey.split("_");
  return parts.length >= 3 && parts[0] === "vl" && parts[1] ? parts[1] : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface OtlpAuthorization {
  teamId: string;
  projectId: string;
}

export interface OtlpAuthDeps {
  keys: Map<string, string>;
  verifyExternal?: (bearer: string) => Promise<string | null>;
  resolveProject: (teamId: string, projectName: string) => Promise<string>;
  bindKey: (
    fingerprint: string,
    teamId: string,
    projectId: string,
  ) => Promise<boolean>;
}

const AUTHORIZATION_CACHE_TTL_MS = 60_000;
const AUTHORIZATION_CACHE_MAX_ENTRIES = 1000;

export function createOtlpAuthorizer(deps: OtlpAuthDeps) {
  // Envoy consults this authorizer on every OTLP POST — one per SDK flush —
  // so an uncached path would turn telemetry volume into Postgres write
  // volume. Successful (key, project) authorizations are cached briefly,
  // mirroring the hexclaveKeyVerifier cache; rejections are never cached so
  // a revoked key or conflicting binding keeps failing immediately.
  const cache = new Map<string, { value: OtlpAuthorization; expires: number }>();

  async function authenticate(bearer: string): Promise<string | null> {
    const localId = keyIdOf(bearer);
    if (localId) {
      const expected = deps.keys.get(localId);
      if (expected && constantTimeEqual(bearer, expected)) return localId;
    }

    return deps.verifyExternal ? await deps.verifyExternal(bearer) : null;
  }

  return async (
    authorization: string | undefined,
    projectName: string | undefined,
  ): Promise<OtlpAuthorization | null> => {
    const bearer = authorization?.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    const normalizedProject = projectName?.trim();
    if (!bearer || !normalizedProject) return null;

    const keyFingerprint = fingerprint(bearer);
    const cacheKey = `${keyFingerprint}\n${normalizedProject}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;

    const teamId = await authenticate(bearer);
    if (!teamId) return null;

    const projectId = await deps.resolveProject(teamId, normalizedProject);
    const allowed = await deps.bindKey(keyFingerprint, teamId, projectId);
    if (!allowed) return null;

    const value: OtlpAuthorization = { teamId, projectId };
    cache.set(cacheKey, {
      value,
      expires: Date.now() + AUTHORIZATION_CACHE_TTL_MS,
    });
    if (cache.size > AUTHORIZATION_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  };
}

export const LAST_SEEN_REFRESH_INTERVAL_MS = 60_000;

/**
 * lastSeenAt is a coarse liveness signal, not an event log: refreshing it on
 * every SDK flush would rewrite the row per batch, so only stale timestamps
 * are worth a write.
 */
export function lastSeenNeedsRefresh(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() > LAST_SEEN_REFRESH_INTERVAL_MS;
}

export async function bindTelemetryKey(
  keyFingerprint: string,
  teamId: string,
  projectId: string,
): Promise<boolean> {
  // One round-trip both claims an unbound fingerprint and, on conflict,
  // returns the existing binding (the no-op update lets RETURNING yield the
  // stored row instead of nothing).
  const [binding] = await db
    .insert(telemetryIngestKeys)
    .values({ fingerprint: keyFingerprint, teamId, projectId })
    .onConflictDoUpdate({
      target: telemetryIngestKeys.fingerprint,
      set: { fingerprint: sql`excluded.fingerprint` },
    })
    .returning({
      teamId: telemetryIngestKeys.teamId,
      projectId: telemetryIngestKeys.projectId,
      lastSeenAt: telemetryIngestKeys.lastSeenAt,
    });

  if (binding?.teamId !== teamId || binding.projectId !== projectId) {
    return false;
  }

  const now = new Date();
  if (lastSeenNeedsRefresh(binding.lastSeenAt, now)) {
    await db
      .update(telemetryIngestKeys)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(telemetryIngestKeys.fingerprint, keyFingerprint),
          eq(telemetryIngestKeys.projectId, projectId),
        ),
      );
  }
  return true;
}

export async function resolveTelemetryProject(
  teamId: string,
  name: string,
): Promise<string> {
  const [project] = await db
    .insert(projects)
    .values({ teamId, name })
    .onConflictDoUpdate({
      target: [projects.teamId, projects.name],
      set: { lastSeenAt: new Date() },
    })
    .returning({ id: projects.id });
  if (!project) throw new Error("Failed to resolve telemetry project");
  return project.id;
}

/**
 * Envoy's ext_authz target. It authenticates metadata only and never reads or
 * decodes OTLP bodies. Successful responses return trusted metadata which the
 * gateway forwards to the Collector.
 */
export function createOtlpAuthApp(
  authorize: ReturnType<typeof createOtlpAuthorizer>,
) {
  const handler = async ({ headers }: { headers: Record<string, string | undefined> }) => {
    const identity = await authorize(
      headers.authorization,
      headers["x-versionless-project"],
    );
    if (!identity) {
      return new Response("invalid ingest key or project", { status: 401 });
    }
    return new Response(null, {
      headers: {
        "x-versionless-team-id": identity.teamId,
        "x-versionless-project-id": identity.projectId,
      },
    });
  };

  return new Elysia({ name: "versionless-otlp-auth" })
    .all("/internal/otlp/auth", handler)
    .all("/internal/otlp/auth/*", handler);
}
