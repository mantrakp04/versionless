import { normalizeRouteKey, type ModelDeclaration } from "@versionless/core";

import { changeVersion, type ChangeLike } from "../chain";
import type { DiffEntry } from "../diff/diff";

export interface CoverageItem {
  entry: DiffEntry;
  by?: ChangeLike;
  reason?: string;
}

export interface StaleDeclaration {
  by: ChangeLike;
  declaration: string;
  reason: string;
}

export interface CoverageReport {
  pass: boolean;
  covered: CoverageItem[];
  uncovered: CoverageItem[];
  warnings: CoverageItem[];
  stale: StaleDeclaration[];
}

export function changeLabel(change: ChangeLike): string {
  return change.kind === "jump"
    ? `jump ${change.from ?? "?"} → ${change.to ?? "?"}`
    : `change ${change.version ?? "?"}`;
}

function routeKey(route: string): string {
  return route.startsWith("trpc:") ? route : normalizeRouteKey(route);
}

function appliesToRoute(change: ChangeLike, endpoint: string): boolean {
  if (change.routes.length === 0) return true;
  const target = routeKey(endpoint);
  return change.routes.some((route) => routeKey(route) === target);
}

function directionProblem(change: ChangeLike, entry: DiffEntry): string | undefined {
  if (entry.requires === "up" && !change.hasUp) {
    return `${changeLabel(change)} declares ${entrySubject(entry)} but has no up()`;
  }
  if (entry.requires === "down" && !change.hasDown) {
    return `${changeLabel(change)} declares ${entrySubject(entry)} but has no down()`;
  }
  return undefined;
}

function entrySubject(entry: DiffEntry): string {
  return entry.model !== undefined && entry.fieldPath !== undefined
    ? `${entry.model}.${entry.fieldPath}`
    : entry.endpoint;
}

function declarationMatchesEntry(
  declaration: ModelDeclaration,
  entry: DiffEntry,
): boolean {
  if (entry.op === "endpoint-removed") {
    return (declaration.routesRemoved ?? []).some(
      (route) => routeKey(route) === routeKey(entry.endpoint),
    );
  }
  if (entry.model !== declaration.model || entry.fieldPath === undefined) {
    return false;
  }

  const path = entry.fieldPath;
  if (entry.op === "field-removed") {
    return (
      declaration.removed?.includes(path) === true ||
      Object.hasOwn(declaration.renamed ?? {}, path)
    );
  }
  if (entry.op === "field-added") {
    return (
      declaration.added?.includes(path) === true ||
      Object.values(declaration.renamed ?? {}).includes(path)
    );
  }
  return declaration.typeChanged?.includes(path) === true;
}

function declaresEntry(change: ChangeLike, entry: DiffEntry): boolean {
  return change.declarations.some((declaration) =>
    declarationMatchesEntry(declaration, entry),
  );
}

function candidateMatchesEntry(change: ChangeLike, entry: DiffEntry): boolean {
  if (!appliesToRoute(change, entry.endpoint)) return false;
  if (declaresEntry(change, entry)) return true;

  // Anonymous schemas cannot be named in a declaration. A route-scoped change
  // with the required transform is the explicit coverage signal instead.
  return (
    entry.model === undefined &&
    entry.op !== "endpoint-removed" &&
    change.routes.length > 0
  );
}

interface DeclarationAtom {
  declaration: string;
  matches(entry: DiffEntry): boolean;
}

function declarationAtoms(declaration: ModelDeclaration): DeclarationAtom[] {
  const atoms: DeclarationAtom[] = [];
  for (const field of declaration.removed ?? []) {
    atoms.push({
      declaration: `${declaration.model}.${field} removed`,
      matches: (entry) =>
        entry.model === declaration.model &&
        entry.fieldPath === field &&
        entry.op === "field-removed",
    });
  }
  for (const field of declaration.added ?? []) {
    atoms.push({
      declaration: `${declaration.model}.${field} added`,
      matches: (entry) =>
        entry.model === declaration.model &&
        entry.fieldPath === field &&
        entry.op === "field-added",
    });
  }
  for (const [from, to] of Object.entries(declaration.renamed ?? {})) {
    atoms.push({
      declaration: `${declaration.model}.${from} renamed to ${to}`,
      matches: (entry) =>
        entry.model === declaration.model &&
        ((entry.op === "field-removed" && entry.fieldPath === from) ||
          (entry.op === "field-added" && entry.fieldPath === to)),
    });
  }
  for (const field of declaration.typeChanged ?? []) {
    atoms.push({
      declaration: `${declaration.model}.${field} type changed`,
      matches: (entry) =>
        entry.model === declaration.model &&
        entry.fieldPath === field &&
        entry.op !== "field-added" &&
        entry.op !== "field-removed" &&
        entry.op !== "endpoint-removed",
    });
  }
  for (const route of declaration.routesRemoved ?? []) {
    atoms.push({
      declaration: `${declaration.model} route ${route} removed`,
      matches: (entry) =>
        entry.op === "endpoint-removed" &&
        routeKey(entry.endpoint) === routeKey(route),
    });
  }
  return atoms;
}

export function matchCoverage(
  entries: DiffEntry[],
  chain: ChangeLike[],
  snapshotVersion: string,
  opts: { strictLossy?: boolean } = {},
): CoverageReport {
  const relevant = entries.filter(
    (entry) => entry.severity === "breaking" || entry.severity === "warning",
  );
  const candidates = chain.filter(
    (change) => changeVersion(change) > snapshotVersion,
  );
  const covered: CoverageItem[] = [];
  const uncovered: CoverageItem[] = [];
  const warnings: CoverageItem[] = [];

  for (const entry of relevant) {
    const matching = candidates.filter((change) =>
      candidateMatchesEntry(change, entry),
    );
    const usable = matching.filter((change) => !directionProblem(change, entry));
    const clean = usable.find((change) => !change.lossy);

    if (clean) {
      covered.push({ entry, by: clean });
      continue;
    }

    const lossy = usable[0];
    if (lossy) {
      const reason = opts.strictLossy
        ? `${changeLabel(lossy)} is lossy and --strict-lossy is enabled`
        : `${changeLabel(lossy)} is lossy`;
      if (opts.strictLossy) uncovered.push({ entry, by: lossy, reason });
      else warnings.push({ entry, by: lossy, reason });
      continue;
    }

    const directionMismatch = matching[0];
    const reason = directionMismatch
      ? directionProblem(directionMismatch, entry)
      : entry.severity === "warning"
        ? "not declared by a registered change"
        : "no matching registered change";
    if (entry.severity === "warning") warnings.push({ entry, reason });
    else uncovered.push({ entry, reason });
  }

  const stale: StaleDeclaration[] = [];
  for (const change of candidates) {
    for (const declaration of change.declarations) {
      for (const atom of declarationAtoms(declaration)) {
        const observed = relevant.some(
          (entry) =>
            appliesToRoute(change, entry.endpoint) && atom.matches(entry),
        );
        if (!observed) {
          stale.push({
            by: change,
            declaration: atom.declaration,
            reason: `${changeLabel(change)} declares ${atom.declaration}, but no observed diff matches it (typo?)`,
          });
        }
      }
    }
  }

  return {
    pass: uncovered.length === 0,
    covered,
    uncovered,
    warnings,
    stale,
  };
}
