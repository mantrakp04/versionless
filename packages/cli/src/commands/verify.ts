import type { Change, ChangeMeta, Jump } from "@versionless/core";
import { verifyChain, type IntegrityIssue } from "@versionless/core/integrity";

import { loadChangeChain } from "../chain";
import { bold, dim, green, red, yellow } from "../colors";
import { GLOBAL_OPTIONS, loadProject, parseFlags, str } from "./shared";

const HELP = `versionless verify — run the change chain's wire-shape fixtures

Every change's \`examples\` are executed against its transforms:
  up(request.old)        must deep-equal request.current
  down(response.current) must deep-equal response.old
and, unless the change is marked \`lossy\`, an injected unknown field must
survive each transform (tolerant-reader probe) — proving transforms spread
fields through instead of rebuilding objects and silently dropping data.

Usage: versionless verify [options]

Options:
  --strict         Changes with transforms but no examples fail (default: warn)
  --config <path>  Path to versionless.config.ts
  --json           Machine-readable output
  -h, --help       Show this help

Exit codes: 0 verified · 1 integrity issue (or missing examples with --strict) ·
2 config error
`;

function hasSpec(change: ChangeMeta): change is ChangeMeta & (Change | Jump) {
  return "spec" in change && typeof (change as { spec?: unknown }).spec === "object";
}

function issueLine(issue: IntegrityIssue): string {
  const where =
    issue.exampleIndex === null
      ? ""
      : ` example[${issue.exampleIndex}]${issue.direction ? ` ${issue.direction}()` : ""}`;
  return `${bold(issue.change)}${where}: ${issue.message}`;
}

export async function runVerify(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const { values } = parseFlags(argv, {
    ...GLOBAL_OPTIONS,
    strict: { type: "boolean", default: false },
  });
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  const strict = values["strict"] === true;

  const project = await loadProject(cwd, str(values["config"]));
  const chain = (await loadChangeChain(project.config, project.entry)).filter(hasSpec);
  const report = await verifyChain(chain);

  const missing = report.issues.filter((i) => i.kind === "missing-examples");
  const failures = report.issues.filter((i) => i.kind !== "missing-examples");
  const pass = failures.length === 0 && (!strict || missing.length === 0);

  if (values["json"] === true) {
    console.log(
      JSON.stringify(
        {
          pass,
          changes: chain.length,
          assertions: report.assertions,
          failures,
          missingExamples: missing.map((i) => i.change),
        },
        null,
        2,
      ),
    );
    return pass ? 0 : 1;
  }

  for (const issue of failures) {
    console.log(`${red("✗")} ${issueLine(issue)}`);
    if (issue.kind === "example-mismatch") {
      console.log(dim(`    expected: ${JSON.stringify(issue.expected)}`));
      console.log(dim(`    actual:   ${JSON.stringify(issue.actual)}`));
    }
  }
  for (const issue of missing) {
    console.log(`${strict ? red("✗") : yellow("⚠")} ${issueLine(issue)}`);
  }

  const counts = `${chain.length} change(s), ${report.assertions} assertion(s), ${failures.length} failure(s), ${missing.length} without examples`;
  console.log(
    pass
      ? `${green("✓ verify passed")} ${dim(`(${counts})`)}`
      : `${red("✗ verify failed")} ${dim(`(${counts})`)}`,
  );
  return pass ? 0 : 1;
}
