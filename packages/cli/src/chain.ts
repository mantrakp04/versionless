import type { ChangeRegistry } from "@versionless/core";
import type { ModelDeclaration } from "@versionless/core";

import { importModule, type LoadedConfig, type LoadedEntry } from "./config";

/**
 * The stable metadata contract of a registered core Change or Jump, as
 * consumed by coverage matching / changelog rendering.
 */
export interface ChangeLike {
  kind: "change" | "jump";
  version?: string;
  from?: string;
  to?: string;
  describe: string;
  routes: readonly string[];
  lossy: boolean;
  hasUp: boolean;
  hasDown: boolean;
  declarations: readonly ModelDeclaration[];
}

/** The version a change (or jump) is introduced at. */
export function changeVersion(change: ChangeLike): string {
  return change.kind === "jump" ? (change.to ?? "") : (change.version ?? "");
}

function looksLikeChange(value: unknown): value is ChangeLike {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v["kind"] === "change" || v["kind"] === "jump") &&
    typeof v["describe"] === "string" &&
    Array.isArray(v["routes"]) &&
    Array.isArray(v["declarations"])
  );
}

/**
 * Load the registered change chain.
 *
 * The change-file glob is ALWAYS imported first: files there that import the
 * entry's instance (the shape `versionless generate` scaffolds) register into
 * its `_registry` as a side effect, so a freshly generated change is visible
 * to `check` without any extra wiring. Then the entry's exported instance is
 * the preferred source — its registry already holds every registered change
 * and jump — with any standalone exported Change/Jump objects from the glob
 * merged in. Without an instance, the glob exports are the whole chain.
 */
export async function loadChangeChain(
  config: LoadedConfig,
  entry: LoadedEntry,
): Promise<ChangeLike[]> {
  const exported: ChangeLike[] = [];
  const glob = new Bun.Glob(config.changesGlob);
  const files = [...glob.scanSync({ cwd: config.rootDir, absolute: true })].sort();
  for (const file of files) {
    let module: Record<string, unknown>;
    try {
      module = await importModule(file);
    } catch (err) {
      // A broken change file must not take down the whole run — but silently
      // skipping it would skew coverage, so say what was skipped.
      console.warn(
        `versionless: skipping change file ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    for (const value of Object.values(module)) {
      if (looksLikeChange(value) && !exported.includes(value)) {
        exported.push(value);
      }
    }
  }

  if (entry.instance) {
    const registry = entry.instance._registry as ChangeRegistry;
    const chain: ChangeLike[] = [...registry.changes, ...registry.jumps];
    const seen = new Set<unknown>(chain);
    for (const change of exported) {
      if (!seen.has(change)) {
        seen.add(change);
        chain.push(change);
      }
    }
    return chain;
  }

  exported.sort((a, b) => {
    const av = changeVersion(a);
    const bv = changeVersion(b);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return exported;
}
