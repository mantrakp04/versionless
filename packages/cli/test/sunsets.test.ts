import { describe, expect, test } from "bun:test";
import { createVersionless } from "@versionless/core";
import type { SunsetOptions } from "@versionless/core";

import type { InstanceLike, LoadedEntry } from "../src/config";
import { extract, extractSunsets } from "../src/commands/shared";

const SURFACE = { manual: [] } as LoadedEntry["surface"];

function instance(...sunsets: [string, SunsetOptions][]): InstanceLike {
  const v = createVersionless({
    scheme: "date",
    current: "2026-07-21",
    resolve: [{ default: "current" }],
  });
  for (const [version, opts] of sunsets) v.sunset(version, opts);
  return v;
}

function entry(instance: InstanceLike | null): LoadedEntry {
  return { surface: SURFACE, instance, module: {} };
}

describe("sunset extraction", () => {
  test("carries every registered sunset, sorted for stable bytes", () => {
    // Registration order follows the customer's source file, which is not
    // meaningful; sorting keeps the emitted snapshot byte-identical across
    // runs so an unchanged surface stays an unchanged upload.
    expect(
      extractSunsets(
        entry(
          instance(
            ["2026-01-01", { after: "2027-03-31" }],
            ["2025-06-01", { after: "2026-09-30", message: "Upgrade." }],
          ),
        ),
      ),
    ).toEqual([
      { version: "2025-06-01", after: "2026-09-30", message: "Upgrade." },
      { version: "2026-01-01", after: "2027-03-31" },
    ]);
  });

  test("reads an instance with no sunsets as an empty declaration", () => {
    // Empty is a real answer — it is how deleting the last `v.sunset(...)`
    // reaches the server and clears a stale schedule.
    expect(extractSunsets(entry(instance()))).toEqual([]);
  });

  test("does not mutate the instance's registry", () => {
    const v = instance(
      ["2026-01-01", { after: "2027-03-31" }],
      ["2025-06-01", { after: "2026-09-30" }],
    );
    extractSunsets(entry(v)).reverse();
    // The sort above must have run on a copy: registration order is intact.
    expect(v.sunsets().map((s) => s.version)).toEqual([
      "2026-01-01",
      "2025-06-01",
    ]);
  });

  test("reports nothing when the entry exports no instance", () => {
    expect(extractSunsets(entry(null))).toEqual([]);
  });
});

describe("sunsets on the extracted surface", () => {
  // Empty-vs-absent is the wire contract the server reads: an empty array
  // means "this project declares no sunsets" (clear any stale schedule), an
  // absent field means "unknown, don't touch".
  test("an instance with no sunsets still emits the field, empty", () => {
    const surface = extract(
      { config: {} as never, entry: entry(instance()) },
      "2026-07-21",
    );
    expect(surface.sunsets).toEqual([]);
  });

  test("no instance leaves the field absent", () => {
    const surface = extract(
      { config: {} as never, entry: entry(null) },
      "2026-07-21",
    );
    expect(Object.hasOwn(surface, "sunsets")).toBe(false);
  });
});
