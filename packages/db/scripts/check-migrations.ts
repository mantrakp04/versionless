// `bun run db:check` — lint every committed migration for DDL that breaks
// backwards/forwards compat during rolling deploys. Exit 1 on findings.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintMigrationSql, type LintIssue } from "../src/migration-lint";

const dir = join(import.meta.dir, "../src/migrations");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const issues: LintIssue[] = [];
for (const file of files) {
  issues.push(...lintMigrationSql(readFileSync(join(dir, file), "utf8"), file));
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ pass: issues.length === 0, files: files.length, issues }, null, 2));
} else {
  for (const issue of issues) {
    console.error(`✗ ${issue.file} [statement ${issue.statement}] ${issue.rule}`);
    console.error(`    ${issue.excerpt}`);
    console.error(`    ${issue.hint}`);
  }
  console.log(
    issues.length === 0
      ? `✓ db:check passed (${files.length} migration(s), 0 compat issues)`
      : `✗ db:check failed (${issues.length} compat issue(s) across ${files.length} migration(s))`,
  );
}
process.exit(issues.length === 0 ? 0 : 1);
