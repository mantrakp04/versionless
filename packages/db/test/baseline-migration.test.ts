import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitStatements } from "../src/migration-lint";

const baselinePath = join(
  import.meta.dir,
  "../src/migrations/0000_late_supreme_intelligence.sql",
);

describe("baseline migration", () => {
  test("can adopt a schema previously created by db:push", () => {
    const statements = splitStatements(readFileSync(baselinePath, "utf8"));

    expect(statements).not.toHaveLength(0);
    for (const statement of statements) {
      expect(statement).toMatch(
        /^CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS\b/,
      );
    }
  });
});
