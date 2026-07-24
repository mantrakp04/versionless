import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { green, dim, yellow } from "../colors";
import { parseFlags } from "./shared";
import { todayUtc } from "./shared";

const HELP = `versionless init — scaffold versionless in the current directory

Usage: versionless init [options]

Creates (only when absent):
  versionless.config.ts   CLI configuration
  src/versionless.ts      surface entry (defineSurface + core instance)
  .versionless/.gitkeep   snapshot directory
  AGENTS.md               agent workflow (AGENTS.versionless.md when AGENTS.md
                          already exists or is a symlink — never touched)

Options:
  -h, --help  Show this help
`;

const CONFIG_STUB = `import { defineConfig } from "@versionless/cli";

export default defineConfig({
  entry: "src/versionless.ts",
  // snapshotDir: ".versionless",
  // changes: "changes/**/*.ts",
  // instance: "versionless", // named export of the core instance in the entry
});
`;

const ENTRY_STUB = (today: string): string => `import { createVersionless } from "@versionless/core";
import { defineSurface } from "@versionless/cli";

/** The core instance — register changes against this, and let the CLI read them. */
export const versionless = createVersionless({
  project: "my-api",
  scheme: "date",
  current: "${today}",
  resolve: [{ header: "x-api-version" }, { default: "current" }],
});

/**
 * The observable API surface. Register schemas under \`models\` so diffs are
 * reported per-model ("User.name removed in GET /users/:id").
 */
export default defineSurface({
  // elysia: [app],
  // trpc: [{ router: appRouter, mount: "/trpc" }],
  models: {},
  manual: [],
});
`;

const AGENTS_CONTENT = `# Versionless workflow

This project versions its API with versionless. When you change an API schema:

1. Make the schema change (models, routes, tRPC procedures).
2. Run \`versionless check\` — it diffs the live surface against the last
   snapshot and fails on any breaking change that no registered change covers.
3. A breaking change ships in a NEW version: if \`current\` already has a
   committed snapshot, bump \`current\` on the instance (e.g. to today).
4. Run \`versionless generate\` — it scaffolds \`changes/<version>-generated.ts\`
   with the schema declarations and TODO transform stubs for what is uncovered.
5. Fill in the transforms: \`request.up\` converts an OLD request body to the
   current shape; \`response.down\` converts a CURRENT response back to the old
   shape. Keep them pure and total.
6. Re-run \`versionless check\` and the test suite until both are green.
7. Cut a release snapshot with \`versionless snapshot\` and commit it.

Debugging: \`versionless explain "GET /users/:id" --version <v>\` prints the
effective version, the transform path an old client walks, and sunset status.
\`versionless changelog\` renders the chain as markdown.

Renames appear in diffs as a remove + add pair; declare them with
\`renamed: { oldName: "newName" }\` so both sides are covered.
`;

export async function runInit(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const { values } = parseFlags(argv, {
    help: { type: "boolean", short: "h", default: false },
  });
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }

  const created: string[] = [];
  const skipped: string[] = [];

  const writeIfAbsent = (path: string, content: string): void => {
    if (existsSync(path)) {
      skipped.push(path);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    created.push(path);
  };

  writeIfAbsent(join(cwd, "versionless.config.ts"), CONFIG_STUB);
  writeIfAbsent(join(cwd, "src", "versionless.ts"), ENTRY_STUB(todayUtc()));
  writeIfAbsent(join(cwd, ".versionless", ".gitkeep"), "");

  // AGENTS.md: lstat, not stat/exists — a symlink (e.g. AGENTS.md -> CLAUDE.md)
  // must never be followed or replaced.
  const agentsPath = join(cwd, "AGENTS.md");
  let agentsPresent = false;
  try {
    lstatSync(agentsPath);
    agentsPresent = true;
  } catch {
    agentsPresent = false;
  }
  if (agentsPresent) {
    const altPath = join(cwd, "AGENTS.versionless.md");
    if (!existsSync(altPath)) {
      writeFileSync(altPath, AGENTS_CONTENT);
      created.push(altPath);
    } else {
      skipped.push(altPath);
    }
    console.log(
      `${yellow("!")} AGENTS.md already exists (or is a symlink) — left untouched; ` +
        `wrote AGENTS.versionless.md instead. Merge it in when convenient.`,
    );
  } else {
    writeFileSync(agentsPath, AGENTS_CONTENT);
    created.push(agentsPath);
  }

  for (const path of created) console.log(`${green("✓")} created ${path}`);
  for (const path of skipped) console.log(`${dim(`- skipped ${path} (exists)`)}`);
  console.log(
    dim(
      "\nnext: wire your app/router into src/versionless.ts, then run `versionless snapshot`",
    ),
  );
  return 0;
}
