/**
 * Backwards/forwards-compat linter for SQL migrations.
 *
 * During a rolling deploy, old app code runs against the new schema (and, on
 * rollback, new-schema databases serve old code). Every rule here flags DDL
 * that breaks one of those directions and points at the expand → backfill →
 * contract sequence that doesn't.
 *
 * Waiver: a statement containing `-- compat:allow <reason>` is accepted —
 * contract steps are legitimate once every deployed reader/writer is gone;
 * the reason is required so the "why" survives code review.
 */

export interface LintIssue {
  file: string;
  /** 0-based statement index within the file (drizzle statement-breakpoints). */
  statement: number;
  rule: string;
  excerpt: string;
  hint: string;
}

interface Rule {
  id: string;
  test: (statement: string) => boolean;
  hint: string;
}

const RULES: Rule[] = [
  {
    id: "drop-table",
    test: (s) => /\bDROP\s+TABLE\b/i.test(s),
    hint: "Old code still selects from this table mid-deploy. Drop it only as a contract step after every deployed reader is gone, then waive with `-- compat:allow <reason>`.",
  },
  {
    id: "drop-column",
    test: (s) => /\bDROP\s+COLUMN\b/i.test(s),
    hint: "Old code still reads/writes this column mid-deploy. Expand first (stop referencing it in code, deploy everywhere), then contract with a `-- compat:allow <reason>` waiver.",
  },
  {
    id: "rename",
    test: (s) => /\bRENAME\s+(TO|COLUMN)\b/i.test(s),
    hint: "A rename breaks old code instantly and new code on rollback. Add the new name, dual-write, migrate readers, then drop the old name as a later contract step.",
  },
  {
    id: "alter-column-type",
    test: (s) => /\bALTER\s+COLUMN\b[\s\S]*?\b(SET\s+DATA\s+)?TYPE\b/i.test(s),
    hint: "In-place type changes can rewrite the table and break old readers. Add a new column, backfill, migrate readers, drop the old one later.",
  },
  {
    id: "add-not-null-without-default",
    test: (s) =>
      /\bADD\s+COLUMN\b/i.test(s) && /\bNOT\s+NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s),
    hint: "Old code doesn't set this column, so its inserts start failing. Add it with a DEFAULT, or nullable now + backfill + SET NOT NULL in a later migration.",
  },
  {
    id: "set-not-null",
    test: (s) => /\bSET\s+NOT\s+NULL\b/i.test(s),
    hint: "Only safe after a completed backfill AND once no deployed writer inserts NULLs. Waive with `-- compat:allow <reason>` once both hold.",
  },
  {
    id: "destructive-dml",
    test: (s) => /\bTRUNCATE\b/i.test(s) || /\bDELETE\s+FROM\b/i.test(s),
    hint: "Schema migrations must not destroy data. Move cleanup into an explicit, reviewed backfill script — or waive with `-- compat:allow <reason>` if this is intentional.",
  },
];

const WAIVER = /--\s*compat:allow[ \t]+\S/;
const BREAKPOINT = "--> statement-breakpoint";

export function splitStatements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function lintMigrationSql(sql: string, file: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const statements = splitStatements(sql);
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]!;
    if (WAIVER.test(statement)) continue;
    for (const rule of RULES) {
      if (!rule.test(statement)) continue;
      issues.push({
        file,
        statement: i,
        rule: rule.id,
        excerpt: statement.replace(/\s+/g, " ").slice(0, 120),
        hint: rule.hint,
      });
    }
  }
  return issues;
}
