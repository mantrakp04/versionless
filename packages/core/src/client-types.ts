/**
 * Type-level derivation of per-version wire types.
 *
 * `ClientTypes<typeof api, '2026-05-14'>['GET /users/:id']` yields the request
 * and response shapes a client pinned at that version sends/receives — derived
 * by composing the registered change chain in reverse, without codegen.
 *
 * Key reduction: no function-type composition is needed. For pinned version P
 * and route R, with the applicable ascending chain c1 < ... < cn:
 *   - the client's request type is the FIRST applicable change's up() param
 *     (ups run oldest-first, and the client speaks the oldest shape), and
 *   - the client's response type is the FIRST applicable change's down()
 *     return (downs run newest-first, so the oldest change's down produces the
 *     client-visible shape).
 *
 * Constraints (documented in docs/client-types):
 *   - P must be a KNOWN version (a registered change version or `current`) —
 *     there is no type-level date arithmetic; the sorted tuple order is used.
 *   - Transform authors must annotate up/down parameter and return types, or
 *     derivation degrades to `unknown`.
 *   - Chain order in `register([...])` must be ascending (runtime warns).
 */
import type { Change, ChangeSpec, VersionedApi } from "./types";

type AnyChange = { version: string; spec: ChangeSpec };

// ---------------------------------------------------------------------------
// 1. Drop changes at-or-before pinned version P (tuple is sorted ascending).

/**
 * Valid pin points: a registered change version, `current`, or the `"floor"`
 * sentinel meaning "before the first change" (every transform applies). There
 * is no type-level date comparison, so arbitrary dates are not accepted here
 * even though the runtime normalizes them.
 */
export type KnownVersion<Api extends VersionedApi<any, any>> =
  | Api["changes"][number]["version"]
  | Api["current"]
  | "floor";

type ChangesAfter<
  Cs extends readonly AnyChange[],
  P extends string,
  Seen extends boolean = false,
> = P extends "floor"
  ? Cs
  : Cs extends readonly [
        infer H extends AnyChange,
        ...infer T extends readonly AnyChange[],
      ]
    ? H["version"] extends P
      ? ChangesAfter<T, P, true> // drop the pinned version's own changes
      : Seen extends true
        ? Cs // past P: everything remaining applies
        : ChangesAfter<T, P, false> // before P: drop
    : [];
// P = current (never appears in the tuple) => Seen stays false => [] — correct:
// a current client gets no transforms.

// ---------------------------------------------------------------------------
// 2. Filter by route. R matches a change when it appears in spec.routes
//    (HTTP, exact string as written in the change file) or spec.procedures
//    (tRPC procedure path).

// Conditional extraction (not indexed access) — literal spec types may omit
// `routes`/`procedures` entirely, and indexed access on such unions errors.
type RouteList<S> = S extends { routes: infer R extends readonly string[] }
  ? R[number]
  : never;
type ProcList<S> = S extends { procedures: infer P extends readonly string[] }
  ? P[number]
  : never;

type MatchesRoute<S extends ChangeSpec, R extends string> = R extends
  | RouteList<S>
  | ProcList<S>
  ? true
  : false;

type ForRoute<
  Cs extends readonly AnyChange[],
  R extends string,
> = Cs extends readonly [
  infer H extends AnyChange,
  ...infer T extends readonly AnyChange[],
]
  ? MatchesRoute<H["spec"], R> extends true
    ? [H, ...ForRoute<T, R>]
    : ForRoute<T, R>
  : [];

// ---------------------------------------------------------------------------
// 3. Endpoint extraction, inferred from the up/down signatures.

type UpIn<C extends AnyChange> = C["spec"] extends {
  request: { up: (body: infer I, ...args: any) => any };
}
  ? I
  : never;

type UpOut<C extends AnyChange> = C["spec"] extends {
  request: { up: (...args: any) => infer O };
}
  ? Awaited<O>
  : never;

type DownOut<C extends AnyChange> = C["spec"] extends {
  response: { down: (...args: any) => infer O };
}
  ? Awaited<O>
  : never;

// ---------------------------------------------------------------------------
// 4. Chain validity: each up's output must be assignable to the next up's
//    input. Mismatches surface as ChainError instead of silently lying.

export interface ChainError<Produced, Expected> {
  __versionless_chain_mismatch: { produced: Produced; expected: Expected };
}

type ValidateUps<Cs extends readonly AnyChange[]> = Cs extends readonly [
  infer A extends AnyChange,
  infer B extends AnyChange,
  ...infer Rest extends readonly AnyChange[],
]
  ? [UpOut<A>] extends [never]
    ? ValidateUps<[B, ...Rest]>
    : [UpIn<B>] extends [never]
      ? ValidateUps<[A, ...Rest]> // B has no request transform: skip over it
      : UpOut<A> extends UpIn<B>
        ? ValidateUps<[B, ...Rest]>
        : ChainError<UpOut<A>, UpIn<B>>
  : true;

// ---------------------------------------------------------------------------
// 5. First chain member carrying each transform kind.

type FirstWithReq<Cs extends readonly AnyChange[]> = Cs extends readonly [
  infer H extends AnyChange,
  ...infer T extends readonly AnyChange[],
]
  ? [UpIn<H>] extends [never]
    ? FirstWithReq<T>
    : H
  : never;

type FirstWithRes<Cs extends readonly AnyChange[]> = Cs extends readonly [
  infer H extends AnyChange,
  ...infer T extends readonly AnyChange[],
]
  ? [DownOut<H>] extends [never]
    ? FirstWithRes<T>
    : H
  : never;

// ---------------------------------------------------------------------------
// 6. Public surface.

export interface CurrentShape {
  request?: unknown;
  response?: unknown;
}

export type RouteClientTypes<
  Cs extends readonly AnyChange[],
  R extends string,
  P extends string,
  Shape extends CurrentShape = {},
  Chain extends readonly AnyChange[] = ForRoute<ChangesAfter<Cs, P>, R>,
> = ValidateUps<Chain> extends ChainError<infer A, infer B>
  ? ChainError<A, B>
  : {
      request: [FirstWithReq<Chain>] extends [never]
        ? Shape["request"]
        : UpIn<FirstWithReq<Chain>>;
      response: [FirstWithRes<Chain>] extends [never]
        ? Shape["response"]
        : DownOut<FirstWithRes<Chain>>;
    };

type RoutesOf<Cs extends readonly AnyChange[]> =
  | RouteList<Cs[number]["spec"]>
  | ProcList<Cs[number]["spec"]>;

/**
 * Whole-API map of wire types for a pinned version.
 *
 * `CurrentShapes` (optional) supplies handler-side request/response types per
 * route — core cannot know them; the change chain only describes deltas.
 * Routes touched by changes are always present; on a route with no applicable
 * change, the current shape (or `unknown`) passes through.
 */
export type ClientTypes<
  Api extends VersionedApi<any, any>,
  P extends KnownVersion<Api>,
  CurrentShapes extends Record<string, CurrentShape> = {},
> = {
  [R in RoutesOf<Api["changes"]> | (keyof CurrentShapes & string)]: RouteClientTypes<
    Api["changes"],
    R,
    P,
    R extends keyof CurrentShapes ? CurrentShapes[R] : {}
  >;
};

// Re-exported for completeness in docs examples.
export type { Change };
