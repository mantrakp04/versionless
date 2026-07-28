import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVersionless } from "@versionless/core";

import { loadChangeChain } from "../src/chain";
import type { InstanceLike, LoadedConfig, LoadedEntry } from "../src/config";

function project(files: Record<string, string> = {}): LoadedConfig {
  const rootDir = mkdtempSync(join(tmpdir(), "versionless-chain-"));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(rootDir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return {
    configPath: join(rootDir, "versionless.config.ts"),
    rootDir,
    entry: join(rootDir, "entry.ts"),
    snapshotDir: join(rootDir, ".versionless"),
    changesGlob: "changes/**/*.ts",
    instanceExport: "versionless",
  };
}

function entry(instance: InstanceLike | null): LoadedEntry {
  return {
    surface: { manual: [] } as LoadedEntry["surface"],
    instance,
    module: {},
  };
}

function instanceWithChain() {
  const v = createVersionless({
    scheme: "date",
    current: "2026-07-21",
    resolve: [{ default: "current" }],
  });
  v.change("2026-02-01", { describe: "remove name", routes: ["GET /users/:id"] });
  v.change("2026-05-14", { describe: "split name" });
  v.jump({ from: "2025-01-01", to: "2026-05-14", describe: "hop" });
  return v;
}

describe("loadChangeChain", () => {
  test("reads an instance that has never served a request", async () => {
    // The CLI's exact situation: it imports the entry module and introspects,
    // so nothing has sealed the registry.
    const v = instanceWithChain();
    expect(v._registry.isSealed).toBe(false);
    const chain = await loadChangeChain(project(), entry(v));
    expect(chain.map((c) => c.describe)).toEqual([
      "remove name",
      "split name",
      "hop",
    ]);
  });

  test("reading the chain leaves the registry open for later registration", async () => {
    const v = instanceWithChain();
    await loadChangeChain(project(), entry(v));
    expect(v._registry.isSealed).toBe(false);
    expect(() => v.change("2026-06-01", { describe: "later" })).not.toThrow();
    expect(await loadChangeChain(project(), entry(v))).toHaveLength(4);
  });

  test("merges standalone glob exports the instance does not already hold", async () => {
    const config = project({
      "changes/2026-03-01.ts": `export const change = {
        kind: "change",
        version: "2026-03-01",
        describe: "standalone",
        routes: [],
        lossy: false,
        hasUp: false,
        hasDown: false,
        declarations: [],
      };\n`,
    });
    const chain = await loadChangeChain(config, entry(instanceWithChain()));
    expect(chain.map((c) => c.describe)).toEqual([
      "remove name",
      "split name",
      "hop",
      "standalone",
    ]);
  });

  test("a change file that registers into the instance is not duplicated", async () => {
    // The `versionless generate` scaffold: the file default-exports the very
    // object `v.change(...)` registered, so it arrives twice — once from the
    // instance, once from the glob — and identity dedupe must collapse it.
    const config = project({
      "changes/2026-03-01.ts": `import { versionless as v } from "../instance";

        export default v.change("2026-03-01", { describe: "scaffolded" });\n`,
    });
    const v = instanceWithChain();
    writeFileSync(
      join(config.rootDir, "instance.ts"),
      `export const versionless = globalThis.__chainTestInstance;\n`,
    );
    (globalThis as Record<string, unknown>)["__chainTestInstance"] = v;
    try {
      const chain = await loadChangeChain(config, entry(v));
      expect(chain.map((c) => c.describe)).toEqual([
        "remove name",
        "scaffolded",
        "split name",
        "hop",
      ]);
    } finally {
      delete (globalThis as Record<string, unknown>)["__chainTestInstance"];
    }
  });

  test("without an instance the glob exports are the whole chain, ascending", async () => {
    const file = (version: string, describe: string): string =>
      `export const change = {
        kind: "change",
        version: ${JSON.stringify(version)},
        describe: ${JSON.stringify(describe)},
        routes: [],
        lossy: false,
        hasUp: false,
        hasDown: false,
        declarations: [],
      };\n`;
    const config = project({
      "changes/b.ts": file("2026-05-14", "later"),
      "changes/a.ts": file("2026-02-01", "earlier"),
    });
    const chain = await loadChangeChain(config, entry(null));
    expect(chain.map((c) => c.describe)).toEqual(["earlier", "later"]);
  });
});
