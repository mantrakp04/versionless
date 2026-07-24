import { describe, expect, test } from "bun:test";
import { lintMigrationSql, splitStatements } from "../src/migration-lint";

const BP = "--> statement-breakpoint";

function rules(sql: string): string[] {
  return lintMigrationSql(sql, "test.sql").map((i) => i.rule);
}

describe("splitStatements", () => {
  test("splits on drizzle statement breakpoints", () => {
    expect(splitStatements(`CREATE TABLE a (id text);${BP}\nCREATE TABLE b (id text);`)).toHaveLength(2);
  });
});

describe("migration compat lint", () => {
  test("additive DDL passes", () => {
    expect(
      rules(
        `CREATE TABLE "projects" ("id" uuid PRIMARY KEY);${BP}
         ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;${BP}
         CREATE INDEX "idx" ON "projects" ("id");${BP}
         ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;`,
      ),
    ).toEqual([]);
  });

  test("drop table / drop column / rename are flagged", () => {
    expect(rules(`DROP TABLE "users";`)).toEqual(["drop-table"]);
    expect(rules(`ALTER TABLE "users" DROP COLUMN "email";`)).toEqual(["drop-column"]);
    expect(rules(`ALTER TABLE "users" RENAME TO "accounts";`)).toEqual(["rename"]);
    expect(rules(`ALTER TABLE "users" RENAME COLUMN "email" TO "mail";`)).toEqual(["rename"]);
  });

  test("NOT NULL additions need a DEFAULT", () => {
    expect(rules(`ALTER TABLE "users" ADD COLUMN "plan" text NOT NULL;`)).toEqual([
      "add-not-null-without-default",
    ]);
    expect(rules(`ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;`)).toEqual([]);
    expect(rules(`ALTER TABLE "users" ADD COLUMN "plan" text;`)).toEqual([]);
  });

  test("type changes and tightening are flagged", () => {
    expect(rules(`ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE bigint;`)).toEqual([
      "alter-column-type",
    ]);
    expect(rules(`ALTER TABLE "users" ALTER COLUMN "plan" SET NOT NULL;`)).toEqual(["set-not-null"]);
  });

  test("destructive DML is flagged", () => {
    expect(rules(`TRUNCATE "events";`)).toEqual(["destructive-dml"]);
    expect(rules(`DELETE FROM "events" WHERE ts < now();`)).toEqual(["destructive-dml"]);
  });

  test("compat:allow with a reason waives the statement", () => {
    expect(
      rules(`-- compat:allow contract step, no deployed reader since 2026-07-01\nALTER TABLE "users" DROP COLUMN "name";`),
    ).toEqual([]);
    // A bare marker without a reason does not waive.
    expect(rules(`-- compat:allow\nALTER TABLE "users" DROP COLUMN "name";`)).toEqual(["drop-column"]);
  });

  test("waiver is per-statement, not per-file", () => {
    const issues = rules(
      `-- compat:allow contract, verified\nDROP TABLE "old_events";${BP}\nALTER TABLE "users" DROP COLUMN "email";`,
    );
    expect(issues).toEqual(["drop-column"]);
  });

  test("statement index points at the offender", () => {
    const issues = lintMigrationSql(
      `CREATE TABLE a (id text);${BP}\nDROP TABLE b;`,
      "0001_x.sql",
    );
    expect(issues[0]!.statement).toBe(1);
    expect(issues[0]!.file).toBe("0001_x.sql");
  });
});
