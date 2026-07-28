import { RegistrationError } from "./errors";
import {
  compilePattern,
  normalizeRouteKey,
  splitRouteKey,
  type CompiledPattern,
} from "./matcher";
import type { VersionScheme } from "./scheme";
import type {
  Change,
  ChangeSpec,
  Jump,
  JumpSpec,
  ModelDeclaration,
  SchemaDelta,
  SunsetEntry,
  SunsetOptions,
} from "./types";

export function compileDeclarations(
  schema: ((s: SchemaDelta) => void) | undefined,
): ModelDeclaration[] {
  if (!schema) return [];
  const declarations: ModelDeclaration[] = [];
  const collector: SchemaDelta = {
    on(model, delta) {
      declarations.push({ model, ...delta });
      return collector;
    },
  };
  schema(collector);
  return declarations;
}

/** "user.get" -> "trpc:user.get"; HTTP routes normalize params to :*. */
export function canonicalRouteKeys(spec: {
  routes?: readonly string[];
  procedures?: readonly string[];
}): string[] {
  const keys: string[] = [];
  for (const route of spec.routes ?? []) keys.push(normalizeRouteKey(route));
  for (const proc of spec.procedures ?? []) keys.push(`trpc:${proc}`);
  return keys;
}

export interface CompiledRewrite {
  fromPattern: CompiledPattern;
  fromKey: string;
  /** Original target route (param names intact), e.g. "GET /teams/:id". */
  toRoute: string;
  toRouteKey: string;
  toMethod: string;
  /** Clients pinned strictly before this version get the rewrite. */
  changeVersion: string;
}

interface RouteChanges {
  changes: Change[];
  jumps: Jump[];
}

export class ChangeRegistry {
  private sealed = false;
  readonly changes: Change[] = [];
  readonly jumps: Jump[] = [];
  readonly sunsets: SunsetEntry[] = [];
  readonly rewrites: CompiledRewrite[] = [];
  /**
   * Distinct change/jump versions + current, ascending. Populated on seal;
   * empty before then — read `computeReleaseVersions()` when the registry may
   * still be open (tooling imports an entry without ever serving a request).
   */
  releaseVersions: string[] = [];
  private routeIndex = new Map<string, RouteChanges>();
  /** Precompiled patterns for the HTTP route keys that have changes. */
  private changedRoutePatterns: CompiledPattern[] | null = null;

  constructor(
    readonly scheme: VersionScheme,
    readonly current: string,
  ) {
    if (!scheme.isValid(current)) {
      throw new RegistrationError(
        `Invalid current version "${current}" for scheme "${scheme.name}"`,
      );
    }
  }

  get isSealed(): boolean {
    return this.sealed;
  }

  private assertOpen(what: string): void {
    if (this.sealed) {
      throw new RegistrationError(
        `Cannot register ${what} after the registry is sealed (a request was already served). ` +
          `Register all changes before wiring the adapter.`,
      );
    }
  }

  private assertVersion(version: string, what: string): void {
    if (!this.scheme.isValid(version)) {
      throw new RegistrationError(
        `Invalid ${what} version "${version}" for scheme "${this.scheme.name}"`,
      );
    }
  }

  addChange<V extends string, S extends ChangeSpec>(version: V, spec: S): Change<V, S> {
    this.assertOpen(`change ${version}`);
    this.assertVersion(version, "change");
    if (this.scheme.compare(version, this.current) > 0) {
      throw new RegistrationError(
        `Change version ${version} is newer than current (${this.current})`,
      );
    }
    if (!spec.describe) {
      throw new RegistrationError(`Change ${version} is missing "describe"`);
    }
    // Dedupe (bun --hot re-imports change files): same version + describe is
    // the same change; return the already-registered instance.
    const existing = this.changes.find(
      (c) => c.version === version && c.describe === spec.describe,
    );
    if (existing) return existing as Change<V, S>;

    const change: Change<V, S> = {
      kind: "change",
      version,
      spec,
      describe: spec.describe,
      routes: canonicalRouteKeys(spec),
      lossy: spec.lossy ?? false,
      hasUp: !!spec.request,
      hasDown: !!spec.response,
      declarations: compileDeclarations(spec.schema),
    };

    // Insertion sort keeps `changes` ascending; ties keep registration order.
    let i = this.changes.length;
    while (i > 0 && this.scheme.compare(this.changes[i - 1]!.version, version) > 0) i--;
    this.changes.splice(i, 0, change);

    for (const key of change.routes) this.indexRoute(key).changes.splice(this.insertPos(this.indexRoute(key).changes, version), 0, change);

    if (spec.rewrite) {
      const fromKey = normalizeRouteKey(spec.rewrite.from);
      const toKey = normalizeRouteKey(spec.rewrite.to);
      const { method: toMethod } = splitRouteKey(spec.rewrite.to);
      this.rewrites.push({
        fromPattern: compilePattern(spec.rewrite.from),
        fromKey,
        toRoute: spec.rewrite.to,
        toRouteKey: toKey,
        toMethod,
        changeVersion: version,
      });
    }
    return change;
  }

  addJump(spec: JumpSpec): Jump {
    this.assertOpen(`jump ${spec.from}->${spec.to}`);
    this.assertVersion(spec.from, "jump.from");
    this.assertVersion(spec.to, "jump.to");
    if (this.scheme.compare(spec.from, spec.to) >= 0) {
      throw new RegistrationError(
        `Jump from ${spec.from} to ${spec.to} must go forward (from < to)`,
      );
    }
    const jump: Jump = {
      kind: "jump",
      from: spec.from,
      to: spec.to,
      spec,
      describe: spec.describe ?? `jump ${spec.from} -> ${spec.to}`,
      routes: canonicalRouteKeys(spec),
      lossy: spec.lossy ?? false,
      hasUp: !!spec.request,
      hasDown: !!spec.response,
      declarations: compileDeclarations(spec.schema),
    };
    const existing = this.jumps.find(
      (j) => j.from === jump.from && j.to === jump.to && j.describe === jump.describe,
    );
    if (existing) return existing;
    this.jumps.push(jump);
    for (const key of jump.routes) this.indexRoute(key).jumps.push(jump);
    return jump;
  }

  addSunset(version: string, opts: SunsetOptions): void {
    this.assertOpen(`sunset ${version}`);
    this.assertVersion(version, "sunset");
    this.sunsets.push({ version, after: opts.after, message: opts.message });
  }

  /**
   * The distinct release versions implied by what is registered right now,
   * ascending. Computed from `changes`/`jumps` rather than read off
   * `releaseVersions` so it answers correctly on an OPEN registry — the CLI
   * imports an entry and introspects it without ever serving a request, which
   * is what seals it.
   */
  computeReleaseVersions(): string[] {
    const versions = new Set<string>([this.current]);
    for (const c of this.changes) versions.add(c.version);
    for (const j of this.jumps) {
      versions.add(j.from);
      versions.add(j.to);
    }
    return [...versions].sort(this.scheme.compare);
  }

  seal(): void {
    if (this.sealed) return;
    this.sealed = true;
    this.releaseVersions = this.computeReleaseVersions();
    // Hot path: matchChangedRoute runs per request, so the changed-route
    // patterns compile once here (matchRewrite already uses precompiled ones).
    this.changedRoutePatterns = this.compileChangedRoutes();
    // Jumps must land on known release versions so the hop walk terminates on
    // chain positions. `from`/`to` were added above, so validate spanned
    // consistency only: nothing to do — any from/to pair is a valid edge now.
  }

  /**
   * Normalize a requested version to the newest release version <= it.
   * Requests older than the first release map to the first release's floor
   * (all changes apply either way); returns the requested version then, so
   * telemetry still shows what was asked for.
   */
  effectiveVersion(requested: string): string {
    const versions = this.releaseVersions;
    let lo = 0;
    let hi = versions.length - 1;
    let best: string | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.scheme.compare(versions[mid]!, requested) <= 0) {
        best = versions[mid]!;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best ?? requested;
  }

  routeChanges(normKey: string): RouteChanges | undefined {
    return this.routeIndex.get(normKey);
  }

  /** Match a raw request against the (small) set of routes that have changes. */
  matchChangedRoute(method: string, path: string): string | null {
    const target = method.toUpperCase();
    // Sealed registries hit the seal-time compile; unsealed ones (tests,
    // tooling) compile lazily and invalidate on registration.
    this.changedRoutePatterns ??= this.compileChangedRoutes();
    for (const pattern of this.changedRoutePatterns) {
      if (pattern.method !== target) continue;
      if (pattern.match(target, path)) return pattern.source;
    }
    return null;
  }

  /** Find a rewrite whose `from` matches and whose change postdates the client's version. */
  matchRewrite(
    method: string,
    path: string,
    effectiveVersion: string,
  ): { rewrite: CompiledRewrite; params: Record<string, string> } | null {
    for (const rewrite of this.rewrites) {
      if (this.scheme.compare(effectiveVersion, rewrite.changeVersion) >= 0) continue;
      const params = rewrite.fromPattern.match(method, path);
      if (params) return { rewrite, params };
    }
    return null;
  }

  private compileChangedRoutes(): CompiledPattern[] {
    const patterns: CompiledPattern[] = [];
    for (const key of this.routeIndex.keys()) {
      if (!key.startsWith("trpc:")) patterns.push(compilePattern(key));
    }
    return patterns;
  }

  private indexRoute(key: string): RouteChanges {
    let entry = this.routeIndex.get(key);
    if (!entry) {
      entry = { changes: [], jumps: [] };
      this.routeIndex.set(key, entry);
      this.changedRoutePatterns = null;
    }
    return entry;
  }

  private insertPos(list: Change[], version: string): number {
    let i = list.length;
    while (i > 0 && this.scheme.compare(list[i - 1]!.version, version) > 0) i--;
    return i;
  }
}
