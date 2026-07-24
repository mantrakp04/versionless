import type {
  Change,
  ChangeExample,
  Jump,
  TransformCtx,
  TransformFn,
} from "./types";

/**
 * Data-integrity verification for registered changes and jumps, driven by the
 * wire-shape fixtures declared in `spec.examples`:
 *
 * - fixture equality: `up(request.old)` must deep-equal `request.current`,
 *   `down(response.current)` must deep-equal `response.old`
 * - tolerant-reader probe: a sentinel field injected into the input must
 *   survive the transform (unless the change is marked `lossy`) — transforms
 *   must spread unknown fields through, never rebuild objects field-by-field
 *
 * Used by `versionless verify` and directly from test suites.
 */

export const PROBE_KEY = "__versionless_probe";
const PROBE_VALUE = "vl-probe-4f6e";

export interface IntegrityIssue {
  /** Change label: "2026-05-14" for changes, "2025-01-01->2026-07-21" for jumps. */
  change: string;
  describe: string;
  /** Index into spec.examples, or null for change-level issues. */
  exampleIndex: number | null;
  direction: "up" | "down" | null;
  kind:
    | "example-mismatch"
    | "probe-dropped"
    | "transform-threw"
    | "invalid-example"
    | "missing-examples";
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface VerifyReport {
  issues: IntegrityIssue[];
  /** Number of fixture assertions that ran (equality + probe). */
  assertions: number;
  /** Steps with transforms but no examples (surfaced as missing-examples issues). */
  unexercised: string[];
}

/** JSON-semantics structural equality: key order ignored, undefined ≡ absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const key of keys) {
    if (!deepEqual(ra[key], rb[key])) return false;
  }
  return true;
}

function stepLabel(step: Change | Jump): string {
  return step.kind === "change" ? step.version : `${step.from}->${step.to}`;
}

function upOf(step: Change | Jump): TransformFn | undefined {
  return step.kind === "change"
    ? (step.spec.request ?? step.spec.input)?.up
    : step.spec.request?.up;
}

function downOf(step: Change | Jump): TransformFn | undefined {
  return step.kind === "change"
    ? (step.spec.response ?? step.spec.output)?.down
    : step.spec.response?.down;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Fixture {
  direction: "up" | "down";
  fn: TransformFn;
  input: unknown;
  expected: unknown;
}

function fixturesOf(
  step: Change | Jump,
  example: ChangeExample,
  index: number,
  issues: IntegrityIssue[],
): Fixture[] {
  const base = { change: stepLabel(step), describe: step.describe, exampleIndex: index };
  const fixtures: Fixture[] = [];
  const up = upOf(step);
  const down = downOf(step);

  if (example.request) {
    if (!up) {
      issues.push({
        ...base,
        direction: "up",
        kind: "invalid-example",
        message: "example declares a request fixture but the change has no request.up",
      });
    } else {
      fixtures.push({
        direction: "up",
        fn: up,
        input: example.request.old,
        expected: example.request.current,
      });
    }
  }
  if (example.response) {
    if (!down) {
      issues.push({
        ...base,
        direction: "down",
        kind: "invalid-example",
        message: "example declares a response fixture but the change has no response.down",
      });
    } else {
      fixtures.push({
        direction: "down",
        fn: down,
        input: example.response.current,
        expected: example.response.old,
      });
    }
  }
  if (!example.request && !example.response) {
    issues.push({
      ...base,
      direction: null,
      kind: "invalid-example",
      message: "example declares neither a request nor a response fixture",
    });
  }
  return fixtures;
}

/** Verify one change/jump against its declared examples. */
export async function verifyChange(
  step: Change | Jump,
  opts: { probeKey?: string } = {},
): Promise<VerifyReport> {
  const probeKey = opts.probeKey ?? PROBE_KEY;
  const label = stepLabel(step);
  const issues: IntegrityIssue[] = [];
  let assertions = 0;

  const examples = step.spec.examples ?? [];
  const hasTransforms = !!upOf(step) || !!downOf(step);

  if (examples.length === 0) {
    if (hasTransforms) {
      issues.push({
        change: label,
        describe: step.describe,
        exampleIndex: null,
        direction: null,
        kind: "missing-examples",
        message:
          "change has wire transforms but declares no examples — its correctness is unverified",
      });
      return { issues, assertions, unexercised: [label] };
    }
    return { issues, assertions, unexercised: [] };
  }

  const ctx: TransformCtx = {
    version: step.kind === "change" ? step.version : step.from,
    route: step.routes[0] ?? "verify",
  };

  for (let i = 0; i < examples.length; i++) {
    for (const fixture of fixturesOf(step, examples[i]!, i, issues)) {
      const base = {
        change: label,
        describe: step.describe,
        exampleIndex: i,
        direction: fixture.direction,
      };

      let actual: unknown;
      try {
        actual = await fixture.fn(structuredClone(fixture.input), ctx);
      } catch (err) {
        issues.push({
          ...base,
          kind: "transform-threw",
          message: `${fixture.direction}() threw: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      assertions++;
      if (!deepEqual(actual, fixture.expected)) {
        issues.push({
          ...base,
          kind: "example-mismatch",
          message: `${fixture.direction}() output does not match the expected fixture`,
          expected: fixture.expected,
          actual,
        });
      }

      // Tolerant-reader probe: unknown fields must pass through untouched so
      // old servers/clients can add fields without breaking pinned peers.
      // Lossy changes are exempt — they declare data loss up front.
      if (step.lossy || !isPlainObject(fixture.input)) continue;
      let probed: unknown;
      try {
        probed = await fixture.fn(
          { ...structuredClone(fixture.input), [probeKey]: PROBE_VALUE },
          ctx,
        );
      } catch {
        continue; // the equality run above already exercised throw reporting
      }
      assertions++;
      if (!isPlainObject(probed) || probed[probeKey] !== PROBE_VALUE) {
        issues.push({
          ...base,
          kind: "probe-dropped",
          message:
            `${fixture.direction}() drops unknown fields (injected probe field did not survive). ` +
            `Spread the input (\`{ ...rest }\`) instead of rebuilding the object, or mark the change \`lossy\`.`,
        });
      }
    }
  }

  return { issues, assertions, unexercised: [] };
}

/** Verify a whole chain; aggregates per-step reports. */
export async function verifyChain(
  steps: readonly (Change | Jump)[],
  opts: { probeKey?: string } = {},
): Promise<VerifyReport> {
  const issues: IntegrityIssue[] = [];
  const unexercised: string[] = [];
  let assertions = 0;
  for (const step of steps) {
    const report = await verifyChange(step, opts);
    issues.push(...report.issues);
    unexercised.push(...report.unexercised);
    assertions += report.assertions;
  }
  return { issues, assertions, unexercised };
}
