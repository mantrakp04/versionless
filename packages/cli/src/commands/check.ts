import { loadChangeChain } from "../chain";
import { CliError } from "../errors";
import { diffSurfaces, type DiffEntry } from "../diff/diff";
import { matchCoverage, changeLabel, type CoverageItem, type CoverageReport } from "../coverage/match";
import { latestSnapshot } from "../snapshot/store";
import { bold, dim, green, red, yellow } from "../colors";
import {
  extract,
  GLOBAL_OPTIONS,
  loadProject,
  parseFlags,
  resolveVersion,
  str,
  type Project,
} from "./shared";

const HELP = `versionless check — diff the live surface against the last snapshot
and verify every breaking change is declared by a registered change.

Usage: versionless check [options]

Options:
  --strict-lossy   Lossy changes do not cover breaking diffs (fail instead of warn)
  --github         Emit ::error / ::warning GitHub Actions annotations
  --config <path>  Path to versionless.config.ts
  --json           Full report as JSON
  -h, --help       Show this help

Notes:
  Renames appear as a remove + add pair (no rename detection); cover both
  sides with \`renamed: { old: "new" }\` in the change's schema declaration.

Exit codes: 0 ok/warnings · 1 uncovered breaking change · 2 config error ·
3 extraction failed · 4 snapshot format mismatch
`;

export interface CheckResult {
  project: Project;
  headVersion: string;
  snapshotVersion: string;
  entries: DiffEntry[];
  report: CoverageReport;
}

export async function performCheck(
  cwd: string,
  configPath: string | undefined,
  opts: { strictLossy?: boolean } = {},
): Promise<CheckResult> {
  const project = await loadProject(cwd, configPath);
  const headVersion = resolveVersion(project.entry, undefined);
  const head = extract(project, headVersion);

  const snapshot = latestSnapshot(project.config.snapshotDir);
  if (!snapshot) {
    throw new CliError(
      `No snapshot found in ${project.config.snapshotDir} — run \`versionless snapshot\` first`,
      2,
    );
  }

  const entries = diffSurfaces(snapshot.surface, head);
  const chain = await loadChangeChain(project.config, project.entry);
  const report = matchCoverage(entries, chain, snapshot.version, {
    strictLossy: opts.strictLossy ?? false,
  });
  return { project, headVersion, snapshotVersion: snapshot.version, entries, report };
}

/** Turn an uncovered entry into a copy-pastable schema declaration hint. */
export function fixHint(entry: DiffEntry): string {
  if (entry.op === "endpoint-removed") {
    return `declare it: schema: (s) => s.on('${entry.model ?? "Model"}', { routesRemoved: ['${entry.endpoint}'] })`;
  }
  if (entry.model !== undefined && entry.fieldPath !== undefined) {
    const list =
      entry.op === "field-removed"
        ? "removed"
        : entry.op === "field-added"
          ? "added"
          : "typeChanged";
    return `declare it: schema: (s) => s.on('${entry.model}', { ${list}: ['${entry.fieldPath}'] })`;
  }
  const routeKey = entry.endpoint.startsWith("trpc:")
    ? `procedures: ['${entry.endpoint.slice("trpc:".length)}']`
    : `routes: ['${entry.endpoint}']`;
  const transform =
    entry.requires === "up"
      ? "request: { up: (body) => body }"
      : "response: { down: (body) => body }";
  return `declare it: ${routeKey}, ${transform}`;
}

function describeEntry(entry: DiffEntry): string {
  const subject =
    entry.model !== undefined && entry.fieldPath !== undefined
      ? `${entry.model}.${entry.fieldPath}`
      : (entry.fieldPath ?? entry.endpoint);
  const shape =
    entry.before !== undefined && entry.after !== undefined
      ? ` (${entry.before} → ${entry.after})`
      : entry.before !== undefined
        ? ` (was ${entry.before})`
        : entry.after !== undefined
          ? ` (now ${entry.after})`
          : "";
  return `${entry.op}: ${subject} in ${entry.location}${shape}`;
}

function severityTag(entry: DiffEntry): string {
  switch (entry.severity) {
    case "breaking":
      return red("breaking");
    case "warning":
      return yellow("warning ");
    case "additive":
      return green("additive");
    case "neutral":
      return dim("neutral ");
  }
}

function printHuman(result: CheckResult): void {
  const { report, entries } = result;
  console.log(
    dim(
      `comparing snapshot ${result.snapshotVersion} → head ${result.headVersion}`,
    ),
  );
  if (entries.length === 0) {
    console.log(`${green("✓")} no surface changes`);
    return;
  }

  const items: CoverageItem[] = [
    ...report.uncovered,
    ...report.warnings,
    ...report.covered,
  ];
  const byEndpoint = new Map<string, CoverageItem[]>();
  for (const item of items) {
    const list = byEndpoint.get(item.entry.endpoint) ?? [];
    list.push(item);
    byEndpoint.set(item.entry.endpoint, list);
  }
  const uncoveredSet = new Set(report.uncovered);
  const warningSet = new Set(report.warnings);

  for (const [endpoint, group] of byEndpoint) {
    console.log(`\n${bold(endpoint)}`);
    for (const item of group) {
      const { entry } = item;
      let status: string;
      if (uncoveredSet.has(item)) status = red("✗ uncovered");
      else if (warningSet.has(item)) status = yellow("⚠ warning");
      else status = green(`✓ covered by ${item.by ? changeLabel(item.by) : "?"}`);
      console.log(`  [${severityTag(entry)}] ${describeEntry(entry)}`);
      console.log(`    ${status}${item.reason ? dim(` — ${item.reason}`) : ""}`);
      if (uncoveredSet.has(item)) {
        console.log(`    ${dim(fixHint(entry))}`);
      }
    }
  }

  for (const stale of report.stale) {
    console.log(`\n${yellow("⚠ stale declaration")}: ${stale.reason}`);
  }

  const counts = `${report.uncovered.length} uncovered, ${report.warnings.length} warning(s), ${report.covered.length} covered`;
  console.log(
    report.pass
      ? `\n${green("✓ check passed")} ${dim(`(${counts})`)}`
      : `\n${red("✗ check failed")} ${dim(`(${counts})`)} — run \`versionless generate\` to scaffold the missing change`,
  );
  if (!report.pass && result.headVersion <= result.snapshotVersion) {
    console.log(
      dim(
        `  head version ${result.headVersion} already has a snapshot — a breaking change needs a new version: bump \`current\` on your instance first`,
      ),
    );
  }
}

function printGithub(report: CoverageReport): void {
  for (const item of report.uncovered) {
    console.log(
      `::error title=versionless uncovered breaking change::${describeEntry(item.entry)} — ${fixHint(item.entry)}`,
    );
  }
  for (const item of report.warnings) {
    console.log(
      `::warning title=versionless warning::${describeEntry(item.entry)}${item.reason ? ` — ${item.reason}` : ""}`,
    );
  }
  for (const stale of report.stale) {
    console.log(`::warning title=versionless stale declaration::${stale.reason}`);
  }
}

export async function runCheck(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const { values } = parseFlags(argv, {
    ...GLOBAL_OPTIONS,
    "strict-lossy": { type: "boolean", default: false },
    github: { type: "boolean", default: false },
  });
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }

  const result = await performCheck(cwd, str(values["config"]), {
    strictLossy: values["strict-lossy"] === true,
  });

  if (values["json"] === true) {
    console.log(
      JSON.stringify(
        {
          pass: result.report.pass,
          snapshotVersion: result.snapshotVersion,
          headVersion: result.headVersion,
          entries: result.entries,
          covered: result.report.covered.map((i) => ({
            entry: i.entry,
            by: i.by ? changeLabel(i.by) : undefined,
          })),
          uncovered: result.report.uncovered.map((i) => ({
            entry: i.entry,
            reason: i.reason,
            hint: fixHint(i.entry),
          })),
          warnings: result.report.warnings.map((i) => ({
            entry: i.entry,
            by: i.by ? changeLabel(i.by) : undefined,
            reason: i.reason,
          })),
          stale: result.report.stale.map((s) => s.reason),
        },
        null,
        2,
      ),
    );
  } else if (values["github"] === true) {
    printGithub(result.report);
  } else {
    printHuman(result);
  }

  return result.report.pass ? 0 : 1;
}
