import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import { CliError } from "../errors";
import { loadConfig, loadEntry, type LoadedConfig, type LoadedEntry } from "../config";
import { extractSurface } from "../surface/extract";
import type { Surface } from "../surface/types";

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

export function extract(project: Project, version: string): Surface {
  try {
    return extractSurface(project.entry.surface, { version });
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
