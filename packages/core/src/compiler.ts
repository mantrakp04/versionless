import { TransformError } from "./errors";
import type { ChangeRegistry } from "./registry";
import type {
  Change,
  Jump,
  Tracing,
  TracingSpan,
  TransformCtx,
  TransformFn,
} from "./types";

export interface LabeledTransform {
  fn: TransformFn;
  /** "2026-05-14" for changes, "2025-01-01->2026-07-21" for jumps. */
  label: string;
}

export interface CompiledPipeline {
  routeKey: string | null;
  effectiveVersion: string;
  /** Ascending: the step introduced earliest runs first on requests. */
  steps: (Change | Jump)[];
  ups: LabeledTransform[];
  downs: LabeledTransform[];
  errorDowns: LabeledTransform[];
  transformCount: number;
  passthroughStream: boolean;
  hasAsync: boolean;
}

export const EMPTY_PIPELINE: CompiledPipeline = {
  routeKey: null,
  effectiveVersion: "",
  steps: [],
  ups: [],
  downs: [],
  errorDowns: [],
  transformCount: 0,
  passthroughStream: false,
  hasAsync: false,
};

function isAsyncFn(fn: TransformFn): boolean {
  // Heuristic only — a sync-looking fn returning a Promise is still handled
  // at runtime; this just picks the no-await fast path when possible.
  return fn.constructor.name === "AsyncFunction";
}

function stepLabel(step: Change | Jump): string {
  return step.kind === "change" ? step.version : `${step.from}->${step.to}`;
}

/**
 * Greedy hop walk from the client's effective version up to `current`.
 * At each position, a jump starting exactly there takes priority over the
 * chained changes it spans (longest jump wins on ties); otherwise the next
 * chained change applies. Deterministic and cycle-free because every edge
 * moves strictly forward.
 */
export function walkPath(
  registry: ChangeRegistry,
  routeKey: string,
  effectiveVersion: string,
): (Change | Jump)[] {
  const entry = registry.routeChanges(routeKey);
  if (!entry) return [];
  const { scheme } = registry;
  const steps: (Change | Jump)[] = [];
  let pos = effectiveVersion;

  for (;;) {
    let jump: Jump | null = null;
    for (const j of entry.jumps) {
      if (scheme.compare(j.from, pos) !== 0) continue;
      if (scheme.compare(j.to, registry.current) > 0) continue;
      if (!jump || scheme.compare(j.to, jump.to) > 0) jump = j;
    }
    if (jump) {
      steps.push(jump);
      pos = jump.to;
      continue;
    }
    const next = entry.changes.find((c) => scheme.compare(c.version, pos) > 0);
    if (!next) return steps;
    steps.push(next);
    pos = next.version;
  }
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

export function compilePipeline(
  registry: ChangeRegistry,
  routeKey: string,
  effectiveVersion: string,
): CompiledPipeline {
  const steps = walkPath(registry, routeKey, effectiveVersion);
  if (steps.length === 0) return EMPTY_PIPELINE;

  const ups: LabeledTransform[] = [];
  const downs: LabeledTransform[] = [];
  const errorDowns: LabeledTransform[] = [];
  let passthroughStream = false;

  for (const step of steps) {
    const up = upOf(step);
    if (up) ups.push({ fn: up, label: stepLabel(step) });
    if (step.kind === "change" && step.spec.stream === "passthrough") {
      passthroughStream = true;
    }
  }
  // Downs run newest-change-first so the oldest change produces the final
  // client-visible shape.
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    const down = downOf(step);
    if (down) downs.push({ fn: down, label: stepLabel(step) });
    const errorDown = step.spec.error?.down;
    if (errorDown) errorDowns.push({ fn: errorDown, label: stepLabel(step) });
  }

  return {
    routeKey,
    effectiveVersion,
    steps,
    ups,
    downs,
    errorDowns,
    transformCount: ups.length + downs.length,
    passthroughStream,
    hasAsync: [...ups, ...downs, ...errorDowns].some((t) => isAsyncFn(t.fn)),
  };
}

export class PipelineCache {
  private cache = new Map<string, Map<string, CompiledPipeline>>();

  constructor(private registry: ChangeRegistry) {}

  get(routeKey: string | null, effectiveVersion: string): CompiledPipeline {
    if (!routeKey) return EMPTY_PIPELINE;
    if (effectiveVersion === this.registry.current) return EMPTY_PIPELINE;
    let byVersion = this.cache.get(routeKey);
    if (!byVersion) {
      byVersion = new Map();
      this.cache.set(routeKey, byVersion);
    }
    let pipeline = byVersion.get(effectiveVersion);
    if (!pipeline) {
      pipeline = compilePipeline(this.registry, routeKey, effectiveVersion);
      byVersion.set(effectiveVersion, pipeline);
    }
    return pipeline;
  }
}

export function applyChain(
  transforms: LabeledTransform[],
  direction: "up" | "down" | "error",
  body: unknown,
  ctx: TransformCtx,
  tracing?: Tracing,
  parent?: TracingSpan,
): unknown | Promise<unknown> {
  if (transforms.length === 0) return body;

  const call = (t: LabeledTransform, value: unknown): unknown => {
    const invoke = (): unknown => {
      let next: unknown;
      try {
        next = t.fn(value, ctx);
      } catch (err) {
        throw new TransformError(t.label, ctx.route, direction, err);
      }
      if (next instanceof Promise) {
        return next.catch((err) => {
          throw new TransformError(t.label, ctx.route, direction, err);
        });
      }
      return next;
    };
    if (!tracing) return invoke();
    return tracing.withSpan(
      `versionless.transform.${direction}`,
      { "versionless.change": t.label, "versionless.route": ctx.route },
      parent ?? null,
      invoke,
    );
  };

  let result: unknown = body;
  for (let i = 0; i < transforms.length; i++) {
    const next = call(transforms[i]!, result);
    if (next instanceof Promise) {
      // Switch to the async path for the remainder of the chain.
      return transforms
        .slice(i + 1)
        .reduce((acc: Promise<unknown>, t) => acc.then((v) => call(t, v)), next);
    }
    result = next;
  }
  return result;
}
