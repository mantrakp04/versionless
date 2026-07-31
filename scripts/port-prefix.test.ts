import { describe, expect, test } from "bun:test";

import { isFree, parseComposePrefixes } from "./port-prefix";

describe("port-prefix picker", () => {
  test("claims the prefixes of existing compose projects", () => {
    const output = JSON.stringify([
      { Name: "versionless-30", Status: "running(4)" },
      { Name: "versionless-31", Status: "exited(4)" },
      { Name: "some-other-project", Status: "running(1)" },
    ]);

    expect(parseComposePrefixes(output)).toEqual(new Set(["30", "31"]));
  });

  test("ignores output with no versionless projects", () => {
    expect(parseComposePrefixes("[]")).toEqual(new Set());
    expect(parseComposePrefixes("")).toEqual(new Set());
  });

  test("treats a stopped compose project as taken", () => {
    // Its containers, networks, and volumes still hold the prefix's names.
    expect(isFree({ prefix: "31", services: [], compose: true })).toBe(false);
    expect(isFree({ prefix: "31", services: [], compose: false })).toBe(true);
  });

  test("treats any listening port in the block as taken", () => {
    expect(
      isFree({ prefix: "31", services: ["dashboard"], compose: false }),
    ).toBe(false);
  });
});
