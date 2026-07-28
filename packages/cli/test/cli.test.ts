import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const BIN = join(CLI_DIR, "bin", "versionless.ts");

function run(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): { code: number; out: string; err: string } {
  // The repository CI has a real build upload key. End-to-end CLI fixtures
  // must never inherit it and publish their temporary snapshots.
  const env: Record<string, string | undefined> = {
    ...process.env,
    NO_COLOR: "1",
  };
  delete env.VERSIONLESS_API_KEY;
  delete env.DEMO_VERSIONLESS_API_KEY;
  delete env.VERSIONLESS_API_URL;
  delete env.VERSIONLESS_SERVER_URL;
  Object.assign(env, extraEnv);
  const proc = Bun.spawnSync({
    cmd: [process.execPath, BIN, ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  };
}

let project: string;

function write(rel: string, content: string): void {
  const path = join(project, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

const CONFIG_FILE = `import { defineConfig } from ${JSON.stringify(join(CLI_DIR, "src", "config.ts"))};

export default defineConfig({ entry: "src/versionless.ts" });
`;

const instanceFile = (current: string): string => `import { createVersionless } from "@versionless/core";

export const versionless = createVersionless({
  scheme: "date",
  current: ${JSON.stringify(current)},
  resolve: [{ default: "current" }],
});
`;

const entryFile = (opts: { withName: boolean; importChange: boolean }): string => `import { z } from "zod";
import { defineSurface } from ${JSON.stringify(join(CLI_DIR, "src", "surface", "define.ts"))};
${opts.importChange ? `import "../changes/2026-02-01";` : ""}
export { versionless } from "./instance";

const User = z.object({
  id: z.string(),
  ${opts.withName ? "name: z.string()," : ""}
  email: z.string(),
});

export default defineSurface({
  models: { User },
  manual: [
    {
      method: "get",
      path: "/users/:id",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      response: User,
    },
  ],
});
`;

const CHANGE_FILE = `import { versionless as v } from "../src/instance";

export default v.change("2026-02-01", {
  describe: "remove name from User",
  routes: ["GET /users/:id"],
  schema: (s) => {
    s.on("User", { removed: ["name"] });
  },
  response: {
    down: (body: unknown) => ({ ...(body as object), name: "unknown" }),
  },
});
`;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "versionless-cli-"));
  // Resolve zod / @versionless/core from the CLI package's own node_modules.
  symlinkSync(join(CLI_DIR, "node_modules"), join(project, "node_modules"), "dir");
  write("versionless.config.ts", CONFIG_FILE);
  write("src/instance.ts", instanceFile("2026-01-01"));
  write("src/versionless.ts", entryFile({ withName: true, importChange: false }));
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("versionless CLI end-to-end", () => {
  test("snapshot writes .versionless/<current>.json", () => {
    const result = run(["snapshot", "--check-idempotent"], project);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("2026-01-01.json");
    expect(result.out).toContain("1 endpoint(s), 1 model(s)");
    expect(existsSync(join(project, ".versionless", "2026-01-01.json"))).toBe(true);
  });

  test("snapshot upload without an instance `project` points at createVersionless", () => {
    // VERSIONLESS_API_KEY remains the default key source, but the project name
    // now comes only from the exported instance's cloud config.
    const result = run(["snapshot"], project, {
      VERSIONLESS_API_KEY: "vl_team_secret",
    });
    expect(result.code).toBe(2);
    expect(result.err).toContain("no cloud `project` name is configured");
    expect(result.err).toContain("createVersionless({ project:");
  });

  test("check passes when nothing changed", () => {
    const result = run(["check"], project);
    expect(result.code).toBe(0);
    expect(result.out).toContain("no surface changes");
  });

  test("generate refuses to stamp an already-snapshotted version", () => {
    // Break the surface WITHOUT bumping `current`: head == snapshot version.
    write("src/versionless.ts", entryFile({ withName: false, importChange: false }));

    const check = run(["check"], project);
    expect(check.code).toBe(1);
    expect(check.out).toContain("bump `current`");

    const result = run(["generate"], project);
    expect(result.code).toBe(2);
    expect(result.err).toContain("already has a committed snapshot");
    expect(result.err).toContain("Bump `current`");
    expect(existsSync(join(project, "changes"))).toBe(false);

    write("src/versionless.ts", entryFile({ withName: true, importChange: false }));
  });

  test("check fails (exit 1) after an undeclared breaking change", () => {
    write("src/instance.ts", instanceFile("2026-02-01"));
    write("src/versionless.ts", entryFile({ withName: false, importChange: false }));

    const result = run(["check"], project);
    expect(result.code).toBe(1);
    expect(result.out).toContain("field-removed");
    expect(result.out).toContain("User.name");
    expect(result.out).toContain("uncovered");
    // The fix hint is generated from the entry:
    expect(result.out).toContain("s.on('User', { removed: ['name'] })");
  });

  test("check --json emits the full report", () => {
    const result = run(["check", "--json"], project);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out) as {
      pass: boolean;
      uncovered: { entry: { model?: string; fieldPath?: string } }[];
    };
    expect(report.pass).toBe(false);
    expect(report.uncovered[0]?.entry.model).toBe("User");
    expect(report.uncovered[0]?.entry.fieldPath).toBe("name");
  });

  test("check --github emits error annotations", () => {
    const result = run(["check", "--github"], project);
    expect(result.code).toBe(1);
    expect(result.out).toContain("::error");
  });

  test("generate scaffolds a change file and never overwrites", () => {
    const result = run(["generate"], project);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    const path = join(project, "changes", "2026-02-01-generated.ts");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain(`v.change("2026-02-01"`);
    expect(content).toContain(`.on("User", { removed: ["name"] })`);
    expect(content).toContain(`routes: ["GET /users/:id"]`);
    expect(content).toContain("down: (body)");
    expect(content).not.toContain("request:"); // only the needed direction
    expect(content).toContain("field-removed"); // header lists the diffs

    // The scaffold registers into the instance via the changes glob, so a
    // second run has nothing left to cover — and must not clobber the first.
    const again = run(["generate"], project);
    expect(again.code).toBe(0);
    expect(again.out).toContain("nothing to generate");
    expect(
      existsSync(join(project, "changes", "2026-02-01-generated-2.ts")),
    ).toBe(false);

    // check sees the scaffolded change without any manual import.
    const check = run(["check"], project);
    expect(check.code).toBe(0);
    expect(check.out).toContain("covered by change 2026-02-01");

    // A broken change file is warned about and skipped — the diffs go back to
    // uncovered, and generate picks a fresh -2 path instead of clobbering.
    write("changes/2026-02-01-generated.ts", "import './does-not-exist';\n");
    const broken = run(["check"], project);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("skipping change file");
    const regen = run(["generate"], project);
    expect(regen.code).toBe(0);
    expect(
      existsSync(join(project, "changes", "2026-02-01-generated-2.ts")),
    ).toBe(true);
    rmSync(join(project, "changes", "2026-02-01-generated.ts"));
    rmSync(join(project, "changes", "2026-02-01-generated-2.ts"));
  });

  test("check passes once the change is registered on the instance", () => {
    write("changes/2026-02-01.ts", CHANGE_FILE);
    write("src/versionless.ts", entryFile({ withName: false, importChange: true }));

    const result = run(["check"], project);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("covered by change 2026-02-01");
    expect(result.out).toContain("check passed");
  });

  test("explain walks the transform path for an old client", () => {
    const result = run(
      ["explain", "GET /users/:id", "--version", "2026-01-01", "--json"],
      project,
    );
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    const explained = JSON.parse(result.out) as {
      routeKey: string;
      matched: boolean;
      effectiveVersion: string;
      steps: { label: string; describe: string; transforms: string[] }[];
      transformCount: number;
    };
    expect(explained.routeKey).toBe("GET /users/:*");
    expect(explained.matched).toBe(true);
    expect(explained.steps).toHaveLength(1);
    expect(explained.steps[0]?.describe).toBe("remove name from User");
    expect(explained.steps[0]?.transforms).toEqual(["response.down"]);
    expect(explained.transformCount).toBe(1);
  });

  test("explain (human) renders the tree", () => {
    const result = run(
      ["explain", "GET /users/:id", "--version", "2026-01-01"],
      project,
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("requested version: 2026-01-01");
    expect(result.out).toContain("remove name from User");
    expect(result.out).toContain("transformCount: 1");
  });

  test("changelog renders the chain with snapshot-enriched types", () => {
    const result = run(["changelog"], project);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("## 2026-02-01");
    expect(result.out).toContain("### remove name from User **[BREAKING]**");
    // Enriched from the 2026-01-01 snapshot:
    expect(result.out).toContain("removed `name` (was `string`)");
    expect(result.out).toContain("affected routes: `GET /users/:*`");
  });

  test("changelog --out writes the file", () => {
    const out = join(project, "CHANGELOG.md");
    const result = run(["changelog", "--out", out], project);
    expect(result.code).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("# API Changelog");
  });

  test("unknown snapshot formatVersion exits 4", () => {
    const rogue = join(project, ".versionless", "2099-01-01.json");
    writeFileSync(rogue, JSON.stringify({ formatVersion: 99 }));
    const result = run(["check"], project);
    expect(result.code).toBe(4);
    expect(result.err).toContain("formatVersion");
    rmSync(rogue);
  });

  test("usage errors exit 2", () => {
    expect(run(["check", "--bogus-flag"], project).code).toBe(2);
    expect(run(["frobnicate"], project).code).toBe(2);
    const noConfig = mkdtempSync(join(tmpdir(), "versionless-empty-"));
    try {
      expect(run(["check"], noConfig).code).toBe(2);
    } finally {
      rmSync(noConfig, { recursive: true, force: true });
    }
  });
});

describe("versionless watch", () => {
  test("watch rejects --json", () => {
    const result = run(["watch", "--json"], project);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--json");
  });

  // Re-trigger-on-file-event is not covered here: it depends on the OS
  // delivering `fs.watch` recursive events, which is not reliable in every
  // sandbox/CI filesystem. The debounce/serialize/queue logic behind it is
  // unit-tested against `createRunQueue` in watch.test.ts instead.
  test(
    "runs check once on start and then waits for changes",
    async () => {
      const proc = Bun.spawn({
        cmd: [process.execPath, BIN, "watch", "--debounce", "50"],
        cwd: project,
        env: { ...process.env, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const decoder = new TextDecoder();
      let out = "";
      const reader = proc.stdout.getReader();
      const pump = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out += decoder.decode(value, { stream: true });
        }
      })();

      const waitFor = async (predicate: () => boolean): Promise<void> => {
        const deadline = Date.now() + 20_000;
        while (!predicate()) {
          if (Date.now() > deadline) {
            throw new Error(`watch output timed out; got:\n${out}`);
          }
          await Bun.sleep(50);
        }
      };
      const runs = (): number => out.split("check passed").length - 1;

      try {
        await waitFor(() => out.includes("watching for changes"));
        expect(runs()).toBe(1);
      } finally {
        proc.kill();
        await proc.exited;
        await pump.catch(() => {});
      }
    },
    25_000,
  );
});

describe("versionless init", () => {
  test("scaffolds config, entry, snapshot dir, and AGENTS.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "versionless-init-"));
    try {
      const result = run(["init"], dir);
      expect(result.code).toBe(0);
      expect(existsSync(join(dir, "versionless.config.ts"))).toBe(true);
      expect(existsSync(join(dir, "src", "versionless.ts"))).toBe(true);
      expect(existsSync(join(dir, ".versionless", ".gitkeep"))).toBe(true);
      expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain(
        "versionless check",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("never touches an existing AGENTS.md symlink (lstat, not stat)", () => {
    const dir = mkdtempSync(join(tmpdir(), "versionless-init-"));
    try {
      writeFileSync(join(dir, "CLAUDE.md"), "# claude\n");
      symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
      const result = run(["init"], dir);
      expect(result.code).toBe(0);
      expect(lstatSync(join(dir, "AGENTS.md")).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("# claude\n");
      expect(existsSync(join(dir, "AGENTS.versionless.md"))).toBe(true);
      expect(result.out).toContain("AGENTS.versionless.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("existing files are never overwritten", () => {
    const dir = mkdtempSync(join(tmpdir(), "versionless-init-"));
    try {
      writeFileSync(join(dir, "versionless.config.ts"), "// custom\n");
      const result = run(["init"], dir);
      expect(result.code).toBe(0);
      expect(readFileSync(join(dir, "versionless.config.ts"), "utf8")).toBe(
        "// custom\n",
      );
      expect(result.out).toContain("skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
