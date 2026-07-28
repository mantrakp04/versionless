import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import { CliError } from "../errors";
import { loadConfig, loadEntry, type LoadedConfig, type LoadedEntry } from "../config";
import { extractSurface } from "../surface/extract";
import type { Surface, SurfaceSunset } from "../surface/types";

/** Today's date in UTC, "YYYY-MM-DD". */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface ParsedFlags {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

export function parseFlags(
  argv: string[],
  options: ParseArgsOptionsConfig,
  allowPositionals = false,
): ParsedFlags {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options,
      allowPositionals,
    });
    return {
      values: values as Record<string, string | boolean | undefined>,
      positionals,
    };
  } catch (err) {
    throw new CliError(
      `${err instanceof Error ? err.message : String(err)} (see --help)`,
      2,
    );
  }
}

export const GLOBAL_OPTIONS: ParseArgsOptionsConfig = {
  config: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
};

export function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export interface Project {
  config: LoadedConfig;
  entry: LoadedEntry;
}

export async function loadProject(
  cwd: string,
  configPath: string | undefined,
): Promise<Project> {
  const config = await loadConfig(cwd, configPath);
  const entry = await loadEntry(config);
  return { config, entry };
}

/**
 * The version stamped on an extracted surface: the instance's `current` when
 * the entry exports it, else an explicit --version, else today (UTC).
 */
export function resolveVersion(
  entry: LoadedEntry,
  explicit: string | undefined,
): string {
  return entry.instance?.current ?? explicit ?? todayUtc();
}

/**
 * The sunsets the entry's instance has registered, sorted for stable bytes.
 * Registration order follows the customer's source file, which is not
 * meaningful; sorting keeps the emitted snapshot byte-identical across runs so
 * an unchanged surface stays an unchanged upload.
 */
export function extractSunsets(entry: LoadedEntry): SurfaceSunset[] {
  return [...(entry.instance?.sunsets() ?? [])]
    .map(({ version, after, message }) => ({
      version,
      after,
      ...(message ? { message } : {}),
    }))
    .sort((left, right) => left.version.localeCompare(right.version));
}

export function extract(project: Project, version: string): Surface {
  try {
    const surface = extractSurface(project.entry.surface, { version });
    // Emitted whenever an instance exists, including as an empty array: the
    // registry is the complete declaration, so an upload has to be able to say
    // "this project now has no sunsets" after a `v.sunset(...)` is deleted.
    // Without an instance the field is absent, meaning "unknown, don't touch".
    return project.entry.instance
      ? { ...surface, sunsets: extractSunsets(project.entry) }
      : surface;
  } catch (err) {
    throw new CliError(
      `Surface extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      3,
    );
  }
}

export function countEndpoints(surface: Surface): {
  endpoints: number;
  models: number;
} {
  return {
    endpoints: Object.keys(surface.endpoints).length,
    models: Object.keys(surface.models).length,
  };
}
