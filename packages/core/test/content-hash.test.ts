import { describe, expect, test } from "bun:test";

import { fnv1a, stableStringify } from "../src/content-hash";

describe("snapshot content hashing primitives", () => {
  test("canonicalizes object keys before hashing", () => {
    const left = { version: "2026-07-24", endpoints: { b: 2, a: 1 } };
    const right = { endpoints: { a: 1, b: 2 }, version: "2026-07-24" };

    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(fnv1a(stableStringify(left))).toBe(
      fnv1a(stableStringify(right)),
    );
  });
});
