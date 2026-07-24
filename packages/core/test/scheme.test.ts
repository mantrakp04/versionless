import { describe, expect, test } from "bun:test";
import { dateScheme, semverScheme } from "../src/scheme";

describe("dateScheme", () => {
  test("accepts valid dates", () => {
    expect(dateScheme.isValid("2026-07-21")).toBe(true);
    expect(dateScheme.isValid("2024-02-29")).toBe(true); // leap year
  });

  test("rejects malformed and impossible dates", () => {
    expect(dateScheme.isValid("2026-7-21")).toBe(false);
    expect(dateScheme.isValid("2026-02-30")).toBe(false);
    expect(dateScheme.isValid("2023-02-29")).toBe(false); // not a leap year
    expect(dateScheme.isValid("20260721")).toBe(false);
    expect(dateScheme.isValid("1.2.3")).toBe(false);
  });

  test("compares lexicographically == chronologically", () => {
    expect(dateScheme.compare("2025-01-01", "2026-05-14")).toBe(-1);
    expect(dateScheme.compare("2026-05-14", "2025-01-01")).toBe(1);
    expect(dateScheme.compare("2026-05-14", "2026-05-14")).toBe(0);
  });
});

describe("semverScheme", () => {
  test("accepts plain semver, rejects prerelease", () => {
    expect(semverScheme.isValid("1.2.3")).toBe(true);
    expect(semverScheme.isValid("10.0.0")).toBe(true);
    expect(semverScheme.isValid("1.2.3-beta.1")).toBe(false);
    expect(semverScheme.isValid("1.2")).toBe(false);
  });

  test("compares numerically, not lexically", () => {
    expect(semverScheme.compare("2.0.0", "10.0.0")).toBe(-1);
    expect(semverScheme.compare("1.10.0", "1.9.0")).toBe(1);
    expect(semverScheme.compare("1.2.3", "1.2.3")).toBe(0);
  });
});
