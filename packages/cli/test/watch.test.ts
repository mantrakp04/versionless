import { describe, expect, test } from "bun:test";

import { createRunQueue, isRelevant } from "../src/commands/watch";

describe("isRelevant", () => {
  test("accepts watched source and config extensions", () => {
    for (const name of [
      "versionless.ts",
      "app.tsx",
      "config.mts",
      "legacy.cts",
      "script.js",
      "view.jsx",
      "mod.mjs",
      "mod.cjs",
      "2026-01-01.json",
    ]) {
      expect(isRelevant(name)).toBe(true);
    }
  });

  test("rejects unwatched extensions and extensionless files", () => {
    for (const name of [
      "README.md",
      "styles.css",
      "logo.png",
      "notes.txt",
      "snapshot.json.bak",
      "Makefile",
      ".env",
    ]) {
      expect(isRelevant(name)).toBe(false);
    }
  });

  test("accepts nested paths outside ignored directories", () => {
    expect(isRelevant("src/changes/rename-user.ts")).toBe(true);
    expect(isRelevant(".versionless/2026-01-01.json")).toBe(true);
    expect(isRelevant("src\\changes\\rename-user.ts")).toBe(true);
  });

  test("rejects any path with an ignored segment, at any depth", () => {
    for (const seg of ["node_modules", ".git", ".turbo", "dist", "build"]) {
      expect(isRelevant(`${seg}/index.ts`)).toBe(false);
      expect(isRelevant(`src/${seg}/index.ts`)).toBe(false);
      expect(isRelevant(`a/b/${seg}/c/d/index.ts`)).toBe(false);
      expect(isRelevant(`a\\b\\${seg}\\index.ts`)).toBe(false);
    }
  });

  test("only rejects whole segments, not substrings of them", () => {
    expect(isRelevant("src/distribution/index.ts")).toBe(true);
    expect(isRelevant("src/rebuild/index.ts")).toBe(true);
    expect(isRelevant("node_modules_local/index.ts")).toBe(true);
  });
});

describe("createRunQueue", () => {
  /** A run function that records its reasons and stays in flight until released. */
  function controllable(): {
    runOnce: (reason: string) => Promise<void>;
    reasons: string[];
    release: () => void;
    started: () => number;
  } {
    const reasons: string[] = [];
    let releases: Array<() => void> = [];
    return {
      reasons,
      started: () => reasons.length,
      release: () => {
        const pending = releases;
        releases = [];
        for (const r of pending) r();
      },
      runOnce: (reason: string) =>
        new Promise<void>((resolve) => {
          reasons.push(reason);
          releases.push(resolve);
        }),
    };
  }

  const tick = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));

  test("run() executes immediately and resolves when idle", async () => {
    const reasons: string[] = [];
    const queue = createRunQueue(async (reason) => {
      reasons.push(reason);
    }, 5);

    await queue.run("initial");
    expect(reasons).toEqual(["initial"]);
  });

  test("collapses rapid events within the debounce window into one run", async () => {
    const reasons: string[] = [];
    const queue = createRunQueue(async (reason) => {
      reasons.push(reason);
    }, 20);

    queue.schedule("a.ts changed");
    queue.schedule("b.ts changed");
    queue.schedule("c.ts changed");
    expect(reasons).toEqual([]);

    await tick(60);
    // One run, carrying the most recent reason.
    expect(reasons).toEqual(["c.ts changed"]);
  });

  test("restarts the quiet period on every event", async () => {
    const reasons: string[] = [];
    const queue = createRunQueue(async (reason) => {
      reasons.push(reason);
    }, 40);

    queue.schedule("a.ts changed");
    await tick(25);
    expect(reasons).toEqual([]);
    queue.schedule("b.ts changed"); // resets the 40ms window
    await tick(25);
    expect(reasons).toEqual([]);

    await tick(40);
    expect(reasons).toEqual(["b.ts changed"]);
  });

  test("queues exactly one re-run for changes landing mid-run", async () => {
    const ctl = controllable();
    const queue = createRunQueue(ctl.runOnce, 0);

    const first = queue.run("initial");
    await tick(0);
    expect(ctl.reasons).toEqual(["initial"]);

    // Three changes land while the first run is still in flight.
    await queue.run("a.ts changed");
    await queue.run("b.ts changed");
    await queue.run("c.ts changed");
    expect(ctl.started()).toBe(1); // still only the first run has started

    ctl.release(); // finish run 1 -> exactly one queued re-run starts
    await tick(0);
    expect(ctl.reasons).toEqual(["initial", "c.ts changed"]);

    ctl.release(); // finish run 2 -> nothing left queued
    await first;
    await tick(0);
    expect(ctl.reasons).toEqual(["initial", "c.ts changed"]);
  });

  test("serializes debounced runs against an in-flight run", async () => {
    const ctl = controllable();
    const queue = createRunQueue(ctl.runOnce, 10);

    const first = queue.run("initial");
    await tick(0);
    expect(ctl.started()).toBe(1);

    queue.schedule("a.ts changed");
    queue.schedule("b.ts changed");
    await tick(30); // debounce fires, but run 1 is still in flight
    expect(ctl.started()).toBe(1);

    ctl.release();
    await tick(0);
    expect(ctl.reasons).toEqual(["initial", "b.ts changed"]);
    ctl.release();
    await first;
  });

  test("a run scheduled after the queue drains starts a fresh run", async () => {
    const reasons: string[] = [];
    const queue = createRunQueue(async (reason) => {
      reasons.push(reason);
    }, 5);

    await queue.run("initial");
    queue.schedule("a.ts changed");
    await tick(30);
    queue.schedule("b.ts changed");
    await tick(30);
    expect(reasons).toEqual(["initial", "a.ts changed", "b.ts changed"]);
  });

  test("cancel() drops a pending debounced run", async () => {
    const reasons: string[] = [];
    const queue = createRunQueue(async (reason) => {
      reasons.push(reason);
    }, 20);

    queue.schedule("a.ts changed");
    queue.cancel();
    await tick(60);
    expect(reasons).toEqual([]);

    // The queue stays usable after cancel().
    queue.schedule("b.ts changed");
    await tick(60);
    expect(reasons).toEqual(["b.ts changed"]);
  });
});
