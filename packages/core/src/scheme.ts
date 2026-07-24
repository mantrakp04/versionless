export interface VersionScheme {
  readonly name: "date" | "semver";
  isValid(version: string): boolean;
  /** Total order. Returns -1 if a < b, 0 if equal, 1 if a > b. */
  compare(a: string, b: string): -1 | 0 | 1;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dateScheme: VersionScheme = {
  name: "date",
  isValid(version) {
    if (!DATE_RE.test(version)) return false;
    // Reject impossible calendar dates ("2026-02-31"). Date.UTC rolls
    // invalid days over into the next month, so round-trip and compare.
    const [y, m, d] = version.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    return (
      t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    );
  },
  compare(a, b) {
    // Strict YYYY-MM-DD is lexicographically ordered. This invariant is
    // load-bearing: ClickHouse `version <= X` range queries rely on it too.
    return a < b ? -1 : a > b ? 1 : 0;
  },
};

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export const semverScheme: VersionScheme = {
  name: "semver",
  isValid(version) {
    // No prerelease/build tags in v0.
    return SEMVER_RE.test(version);
  },
  compare(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const x = pa[i] ?? 0;
      const y = pb[i] ?? 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  },
};

export function getScheme(name: "date" | "semver"): VersionScheme {
  return name === "date" ? dateScheme : semverScheme;
}
