import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

import { CliError } from "../errors";
import { fnv1a, stableStringify } from "../surface/canonical";
import { serializeSurface } from "../surface/extract";
import type { Surface, SurfaceProvenance } from "../surface/types";

export function snapshotPath(dir: string, version: string): string {
  return join(dir, `${version}.json`);
}

/**
 * Content hash of a surface, excluding `integrity` (self-reference) and
 * `provenance` (metadata — a CI re-snapshot and a local one of the same
 * surface must hash identically).
 */
export function surfaceHash(surface: Surface): string {
  const { integrity: _i, provenance: _p, ...content } = surface;
  return fnv1a(stableStringify(content));
}

/** GitHub Actions provenance, when running in CI; undefined locally. */
function ciProvenance(env = process.env): SurfaceProvenance | undefined {
  const repo = env["GITHUB_REPOSITORY"];
  const ref = env["GITHUB_REF_NAME"];
  const sha = env["GITHUB_SHA"];
  if (!repo && !ref && !sha) return undefined;
  return {
    ...(repo ? { repo } : {}),
    ...(ref ? { ref } : {}),
    ...(sha ? { sha } : {}),
  };
}

/**
 * Serialize + write `<dir>/<version>.json` with integrity hash and CI
 * provenance; returns the file path.
 *
 * Overwrite protection: an existing snapshot for the same version with
 * DIFFERENT surface content is refused unless `overwrite` is set — a snapshot
 * is a published contract, and silently replacing it would let `check`
 * validate against a rewritten history. Re-writing identical content is
 * always allowed (idempotent).
 */
export function writeSnapshot(
  dir: string,
  surface: Surface,
  opts: { overwrite?: boolean } = {},
): string {
  mkdirSync(dir, { recursive: true });
  const path = snapshotPath(dir, surface.version);
  const hash = surfaceHash(surface);

  if (existsSync(path) && !opts.overwrite) {
    let existingHash: string | null = null;
    try {
      existingHash = surfaceHash(readSnapshot(path));
    } catch {
      // Existing file is corrupt or tampered — still refuse to silently
      // replace it; --overwrite is the explicit way out.
    }
    if (existingHash !== hash) {
      throw new CliError(
        `Snapshot ${path} already exists with different content. ` +
          `A snapshot is a published contract — bump the version for a new surface, ` +
          `or pass --overwrite to intentionally replace it.`,
        2,
      );
    }
  }

  const provenance = ciProvenance();
  const stamped: Surface = {
    ...surface,
    integrity: { algo: "fnv1a-32", hash },
    ...(provenance ? { provenance } : {}),
  };
  writeFileSync(path, serializeSurface(stamped));
  return path;
}

export function readSnapshot(path: string): Surface {
  if (!existsSync(path)) {
    throw new CliError(`Snapshot not found: ${path}`, 2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new CliError(
      `Snapshot ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      4,
    );
  }
  const formatVersion = (parsed as { formatVersion?: unknown } | null)
    ?.formatVersion;
  if (formatVersion !== 1) {
    throw new CliError(
      `Snapshot ${path} has unknown formatVersion ${JSON.stringify(formatVersion)} ` +
        `(this CLI understands formatVersion 1). Upgrade @versionless/cli or re-snapshot.`,
      4,
    );
  }
  const surface = parsed as Surface;
  // Integrity is optional (pre-integrity snapshots load fine), but when
  // present it must match: a snapshot that was hand-edited or corrupted would
  // otherwise silently skew every diff `check` produces.
  if (surface.integrity) {
    const actual = surfaceHash(surface);
    if (surface.integrity.hash !== actual) {
      throw new CliError(
        `Snapshot ${path} failed its integrity check ` +
          `(recorded ${surface.integrity.hash}, actual ${actual}). ` +
          `The file was modified after \`versionless snapshot\` wrote it — ` +
          `restore it from version control or re-snapshot.`,
        4,
      );
    }
  }
  return surface;
}

/** All snapshot versions in `dir`, ascending (dates sort lexicographically). */
export function listSnapshotVersions(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => basename(name, ".json"))
    .sort();
}

export interface SnapshotRef {
  version: string;
  path: string;
  surface: Surface;
}

/** The newest snapshot by filename, or null when none exist. */
export function latestSnapshot(dir: string): SnapshotRef | null {
  const versions = listSnapshotVersions(dir);
  const version = versions[versions.length - 1];
  if (version === undefined) return null;
  const path = snapshotPath(dir, version);
  return { version, path, surface: readSnapshot(path) };
}
