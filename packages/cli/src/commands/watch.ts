import { existsSync, watch, type FSWatcher } from "node:fs";
import { dirname, extname, sep } from "node:path";

import { dim, green, red } from "../colors";
import { loadConfig } from "../config";
import { CliError } from "../errors";
import { GLOBAL_OPTIONS, parseFlags, str } from "./shared";

const HELP = `versionless watch — re-run \`check\` whenever the surface, change
files, or snapshots change on disk.

Usage: versionless watch [options]

Options:
  --strict-lossy   Forwarded to check (lossy changes do not cover breaking diffs)
  --debounce <ms>  Quiet period after a file event before re-running (default: 150)
  --config <path>  Path to versionless.config.ts
  -h, --help       Show this help

Each run executes \`versionless check\` in a fresh process so edits to the
config, entry, and change files are always picked up (module imports are
cached within a process). Press ctrl-c to stop; watch exits 0 on interrupt.
`;

const WATCHED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
]);

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
]);

/**
 * A file event is worth a re-check only when it names a source-ish file that
 * does not live under a build/vendor directory.
 */
export function isRelevant(filename: string): boolean {
  if (!WATCHED_EXTENSIONS.has(extname(filename))) return false;
  return !filename.split(/[\\/]/).some((seg) => IGNORED_SEGMENTS.has(seg));
}

export interface RunQueue {
  /** Run now, serialized against any in-flight run. Resolves when idle. */
  run: (reason: string) => Promise<void>;
  /** Debounce an event; the quiet period restarts on every call. */
  schedule: (reason: string) => void;
  /** Drop a pending debounced run (does not abort an in-flight one). */
  cancel: () => void;
}

/**
 * Debounce file events and serialize the runs they trigger. Events arriving
 * within the quiet period collapse into one run, and any number of events
 * landing while a run is in flight queue exactly one re-run (last reason wins).
 * Extracted from `runWatch` so it is testable without OS filesystem events.
 */
export function createRunQueue(
  runOnce: (reason: string) => Promise<void>,
  debounceMs: number,
): RunQueue {
  let running = false;
  let queued: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async (reason: string): Promise<void> => {
    if (running) {
      queued = reason;
      return;
    }
    running = true;
    let next: string | null = reason;
    while (next !== null) {
      const current = next;
      next = null;
      await runOnce(current);
      next = queued;
      queued = null;
    }
    running = false;
  };

  const schedule = (reason: string): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run(reason);
    }, debounceMs);
  };

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return { run, schedule, cancel };
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export async function runWatch(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const { values } = parseFlags(argv, {
    ...GLOBAL_OPTIONS,
    "strict-lossy": { type: "boolean", default: false },
    debounce: { type: "string" },
  });
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values["json"] === true) {
    throw new CliError(
      "watch is interactive and does not support --json — use `versionless check --json`",
      2,
    );
  }
  const debounceMs = values["debounce"] === undefined ? 150 : Number(values["debounce"]);
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new CliError(`--debounce must be a non-negative number of ms`, 2);
  }

  const config = await loadConfig(cwd, str(values["config"]));

  const checkArgs: string[] = [];
  const configFlag = str(values["config"]);
  if (configFlag !== undefined) checkArgs.push("--config", configFlag);
  if (values["strict-lossy"] === true) checkArgs.push("--strict-lossy");

  const bin = process.argv[1];
  if (bin === undefined) {
    throw new CliError("cannot locate the versionless binary to re-run check", 2);
  }

  const runCheck = async (reason: string): Promise<void> => {
    if (process.stdout.isTTY === true) {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    }
    console.log(dim(`[${timestamp()}] ${reason}`));
    const child = Bun.spawn({
      cmd: [process.execPath, bin, "check", ...checkArgs],
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
    });
    const code = await child.exited;
    const status = code === 0 ? green("✓") : red(`✗ exit ${code}`);
    console.log(`\n${status} ${dim("watching for changes — ctrl-c to stop")}`);
  };

  // Serialize runs; a change that lands mid-run queues exactly one re-run.
  const queue = createRunQueue(runCheck, debounceMs);

  // The config's rootDir covers the entry, change files, and snapshots in the
  // common layout; also watch any of them configured to live outside it.
  const within = (p: string): boolean =>
    p === config.rootDir || p.startsWith(config.rootDir + sep);
  const roots = new Set<string>([config.rootDir]);
  if (!within(config.entry)) roots.add(dirname(config.entry));
  if (!within(config.snapshotDir)) roots.add(config.snapshotDir);

  const watchers: FSWatcher[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    watchers.push(
      watch(root, { recursive: true }, (_event, filename) => {
        if (filename !== null && !isRelevant(filename)) return;
        queue.schedule(
          filename === null ? "change detected" : `${filename} changed`,
        );
      }),
    );
  }

  await queue.run(`watching ${config.rootDir}`);

  return await new Promise<number>((resolveExit) => {
    const stop = (): void => {
      for (const watcher of watchers) watcher.close();
      queue.cancel();
      resolveExit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
