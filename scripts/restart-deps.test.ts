import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";

describe("restart-deps", () => {
  test("recreates dependency volumes and uses the local db:push workflow", () => {
    const restartDeps = packageJson.scripts["restart-deps"];

    expect(restartDeps).toContain("docker compose down -v");
    expect(restartDeps).toContain("bun run start-deps");
    expect(restartDeps).toContain("turbo run db:generate");
    expect(restartDeps).toContain("turbo run db:push");
    expect(restartDeps).toContain("bun run --cwd apps/server seed");
    expect(restartDeps).not.toContain("db:migrate");
  });

  test("keeps ordinary dependency shutdown non-destructive", () => {
    expect(packageJson.scripts["stop-deps"]).toBe("docker compose down");
  });
});
