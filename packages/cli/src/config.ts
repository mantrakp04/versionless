import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ChangeMeta, ChangeRegistry, SunsetEntry } from "@versionless/core";

import { CliError } from "./errors";
import type { SurfaceDefinition } from "./surface/define";

export interface VersionlessCliConfig {
  /** Path to the surface entry module (default-exports `defineSurface(...)`). */
  entry: string;
  /** Snapshot directory, relative to the config file. Default: ".versionless". */
  snapshotDir?: string;
  /** Glob for change files, used when the entry does not export the instance. Default: "changes/**\/*.ts". */
  changes?: string;
  /** Name of the entry export holding the core instance. Default: "versionless". */
  instance?: string;
}

/** Identity helper for typed `versionless.config.ts` files. */
export function defineConfig(config: VersionlessCliConfig): VersionlessCliConfig {
  return config;
}

export interface LoadedConfig {
  configPath: string;
  /** Directory containing the config file; all relative paths resolve from here. */
  rootDir: string;
  entry: string; // absolute
  snapshotDir: string; // absolute
  changesGlob: string;
  instanceExport: string;
}

const CONFIG_NAME = "versionless.config.ts";

function findConfig(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Import a TS/JS module by absolute path. Deliberately NO cache-buster: change
 * files import the entry by its bare specifier, and a query-busted entry URL
 * would evaluate the module graph twice (two core instances, empty registry).
 * The CLI is a one-shot process, so staleness is not a concern.
 */
async function importModule(path: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
}

export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<LoadedConfig> {
  const configPath = explicitPath
    ? resolve(cwd, explicitPath)
    : findConfig(cwd);
  if (!configPath || !existsSync(configPath)) {
    throw new CliError(
      explicitPath
        ? `Config file not found: ${explicitPath}`
        : `No ${CONFIG_NAME} found in ${cwd} or any parent directory. Run \`versionless init\` to create one.`,
      2,
    );
  }

  let module: Record<string, unknown>;
  try {
    module = await importModule(configPath);
  } catch (err) {
    throw new CliError(
      `Failed to load ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      2,
    );
  }
  const config = module["default"];
  if (typeof config !== "object" || config === null) {
    throw new CliError(
      `${configPath} must default-export defineConfig({...})`,
      2,
    );
  }
  const c = config as VersionlessCliConfig;
  if (typeof c.entry !== "string" || c.entry.length === 0) {
    throw new CliError(`${configPath}: "entry" is required`, 2);
  }

  const rootDir = dirname(configPath);
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(rootDir, p));
  return {
    configPath,
    rootDir,
    entry: abs(c.entry),
    snapshotDir: abs(c.snapshotDir ?? ".versionless"),
    changesGlob: c.changes ?? "changes/**/*.ts",
    instanceExport: c.instance ?? "versionless",
  };
}

// ---------------------------------------------------------------------------
// Entry loading

/** The slice of the core instance the CLI relies on. */
export interface InstanceLike {
  current: string;
  /** Known release versions, ascending — correct before the registry seals. */
  versions(): string[];
  /** Registered sunsets, in registration order. */
  sunsets(): readonly SunsetEntry[];
  /** Registered changes (ascending) then jumps, as metadata. */
  chain(): readonly ChangeMeta[];
  _cloud?: {
    project?: string;
    apiKey?: string;
    apiUrl?: string;
  };
  /**
   * Resolver internals, used only by `explain` (walkPath / compilePipeline /
   * effectiveVersion). Everything else goes through the introspection methods
   * above.
   */
  _registry: ChangeRegistry;
}

export interface LoadedEntry {
  surface: SurfaceDefinition;
  /** Present when the entry also exports the core instance. */
  instance: InstanceLike | null;
  module: Record<string, unknown>;
}

const INTROSPECTION = ["versions", "sunsets", "chain"] as const;

/** An object is the core instance if it carries a registry and a `current`. */
function looksLikeInstance(value: unknown): value is InstanceLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "_registry" in value &&
    typeof (value as { current?: unknown }).current === "string"
  );
}

/**
 * The instance is read through its introspection methods, so a core too old to
 * have them fails loudly here rather than silently reporting an empty chain
 * and a vanished sunset schedule.
 */
function assertIntrospectable(instance: InstanceLike, entry: string): void {
  const missing = INTROSPECTION.filter(
    (name) => typeof (instance as unknown as Record<string, unknown>)[name] !== "function",
  );
  if (missing.length > 0) {
    throw new CliError(
      `The versionless instance exported from ${entry} is missing ${missing
        .map((name) => `${name}()`)
        .join(", ")}. Upgrade @versionless/core to a version that exposes ` +
        `change-chain introspection.`,
      3,
    );
  }
}

export async function loadEntry(config: LoadedConfig): Promise<LoadedEntry> {
  if (!existsSync(config.entry)) {
    throw new CliError(`Entry file not found: ${config.entry}`, 2);
  }
  // Let app code (env validation, adapter wiring, listeners) detect that it is
  // being imported by the CLI, before the import evaluates.
  process.env.VERSIONLESS = "1";

  let module: Record<string, unknown>;
  try {
    module = await importModule(config.entry);
  } catch (err) {
    throw new CliError(
      `Failed to import entry ${config.entry}: ${err instanceof Error ? err.message : String(err)}`,
      3,
    );
  }

  const surface = module["default"];
  if (
    typeof surface !== "object" ||
    surface === null ||
    (surface as { __versionless?: unknown }).__versionless !== true
  ) {
    throw new CliError(
      `${config.entry} must default-export the result of defineSurface({...})`,
      3,
    );
  }

  const candidate = module[config.instanceExport];
  let instance: InstanceLike | null = null;
  if (looksLikeInstance(candidate)) {
    assertIntrospectable(candidate, config.entry);
    instance = candidate;
  }
  return { surface: surface as SurfaceDefinition, instance, module };
}

export { importModule };
