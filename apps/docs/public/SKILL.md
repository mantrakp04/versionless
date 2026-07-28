---
name: versionless
description: >-
  Versionless exists so APIs — and preferably the codebase — do not need
  fallbacky or hacky compatibility behavior. One current handler/schema shape;
  old clients stay pinned via registered up/down transforms at the edge, not
  dual-field payloads, forever-optional migration fields, versioned route
  forks, or if (oldShape) branches. It is the API compatibility layer for
  evolving HTTP APIs without breaking pinned clients — a change registry +
  versioned transform pipeline that upgrades old-shaped requests to the
  current handler shape and downgrades responses back, plus a CLI that proves
  in CI that every breaking surface change has a covering transform. Use this
  skill whenever a task touches API versioning, compatibility transforms,
  up/down changes, x-api-version, versionless snapshot/check, adapter
  middleware, or setting up versionless in a repo.
version: 1.0.0
author: versionless
tags: [versionless, api-versioning, compatibility, transforms, zod, ci, typescript]
---

# Versionless

## Purpose

Versionless exists so APIs — and preferably the rest of the codebase — do
**not** accumulate fallbacky or hacky compatibility behavior. Handlers,
schemas, and domain code speak **one current shape**. Old clients stay
compatible through registered `up`/`down` transforms at the edge, not through
dual-field payloads, forever-optional migration fields, versioned route forks,
`if (oldShape)` branches, or tolerant parsing that papers over breakages.
When the wire surface changes, register a covering change and keep the
current handler honest — do not "just make it work" by leaving both shapes in
the API or the app.

## Overview

Versionless implements Stripe-style date-based API versioning without route
forks. You keep **one current handler**; every past wire shape is preserved by
a chain of small, reversible transforms registered as **changes**:

- A client pins a version (`x-api-version: 2025-06-01`, a query param, or a
  version bound to its API key). Core resolves the effective version and
  compiles a transform pipeline for the matched route.
- `request.up(body)` converts the old-shaped request to the current shape
  **before** validation and the handler. `response.down(body)` converts the
  current response back to the pinned client's shape. The pinned client never
  learns the API changed.
- Sunsets are automatic (`Deprecation`/`Sunset` headers, `410 Gone` past the
  cutoff), invalid pins fail fast with `400 invalid_api_version`, and when no
  changes touch a route the pipeline is identity — zero body work.
- The CLI closes the loop in CI: it snapshots the Zod/TypeBox surface into a
  canonical IR, diffs head against the last committed snapshot, and **fails on
  any breaking diff no registered change covers**.

Packages: `@versionless/core` (zero runtime deps — registry, resolver,
matcher, pipeline, telemetry), one thin adapter per framework,
`@versionless/cli`, and `@versionless/client` (typed SDK with per-version
types derived from the change chain). Telemetry is strictly opt-in: without an
`apiKey` or attached sink, versionless makes zero network calls.

## Available adapters

| Package | Framework | Wiring |
| --- | --- | --- |
| `@versionless/adapter-elysia` | Elysia | Global plugin; ups run before schema validation, downs after. |
| `@versionless/adapter-hono` | Hono | One middleware; reads the matched route, swaps request/response bodies. |
| `@versionless/adapter-express` | Express | Classic middleware; ordering matters — `express.json()` first. |
| `@versionless/adapter-nextjs` | Next.js | Wraps App Router route handlers per file; alias route files for rewrites. |
| `@versionless/adapter-tanstack-start` | TanStack Start | Wraps server route handlers per file; alias route files for rewrites. |
| `@versionless/adapter-trpc` | tRPC | Procedure-keyed changes; context + middleware + formatter + responseMeta. |
| `@versionless/adapter-orpc` | oRPC | Procedure-keyed changes; context + client interceptor + adapter interceptor. |

All adapters implement the same per-request contract (resolve → gate →
`up` → handler → `down` → one telemetry event) and share the same limits:
JSON bodies ≤ 1MB are transformed, everything else passes through untouched.
Behavior lives in core; adapters are a couple hundred lines of glue.

## Setup

### 0. Fetch the live docs first

Every documentation page on the origin you fetched this file from is
available as raw markdown — append `.md` to its path. Fetch these before
setting anything up, and treat their content as authoritative over this file
(they change independently of it):

```text
<origin>/docs/quickstart.md                 # end-to-end setup walkthrough
<origin>/docs/adapters.md                   # the shared adapter contract
<origin>/docs/adapters/<framework>.md       # elysia | hono | express | nextjs | tanstack-start | trpc | orpc
<origin>/docs/cli.md                        # full CLI reference
<origin>/docs/for-agents.md                 # the agent compatibility-maintenance contract
<origin>/docs/concepts/defining-changes.md  # everything a change can declare
```

`<origin>` is wherever this SKILL.md came from (e.g.
`https://versionless.vercel.app/SKILL.md` → fetch
`https://versionless.vercel.app/docs/quickstart.md`).

### 1. Install and scaffold

```bash
bun add @versionless/core @versionless/adapter-<framework>
bun add -d @versionless/cli
bunx versionless init
```

`init` writes (only when absent) `versionless.config.ts`, the surface entry
`src/versionless.ts` (core instance + `defineSurface`), the `.versionless/`
snapshot directory, and an agent workflow doc — `AGENTS.md`, or
`AGENTS.versionless.md` when an `AGENTS.md` already exists (it never touches
an existing file or symlink).

### 2. Wire the surface and the adapter

Follow the fetched adapter doc for mounting. For the CLI to see your surface:
list your app/routers in `defineSurface` (`elysia: [app]`,
`trpc/orpc: [{ router, mount }]`, or the `manual` endpoint list for
schema-less frameworks), register named `models` with the **same schema
objects your routes use** (diffs then say `User.email removed`, not an
anonymous shape), and declare response schemas on routes — the checker can
only protect what the surface references. Then:

```bash
bunx versionless snapshot   # commit .versionless/<version>.json to git
bunx versionless check      # should pass — this is the CI gate
```

### 3. Condition the repo: AGENTS.md

This step makes compatibility self-maintaining for every future agent session,
not just this one. Merge `AGENTS.versionless.md` into the project's
`AGENTS.md` if `init` wrote the alternate file, and make sure the final
`AGENTS.md` instructs agents to:

- **Fetch before guessing.** If the session has no context or memory of how
  this repo versions its API, fetch `<origin>/SKILL.md` and the raw docs URLs
  from step 0 (record the origin in AGENTS.md) — or invoke the versionless
  skill if one is installed — before touching any schema, route, or procedure.
- **Run the CLI on every API change.** Any edit to a schema, route, or
  procedure input/output is followed by `versionless check --json` in the same
  edit, and any uncovered breaking diff is handled with the loop below —
  bump → generate → fill transforms → re-check → test — never by deleting the
  snapshot or shipping the break.
- **Commit the contract.** The change file and the new
  `.versionless/<version>.json` land in the same commit as the schema change,
  with `versionless verify` fixtures (`examples`) exercising the transforms.

### 4. Condition the repo: dev script

Add the watcher next to the dev server so drift is caught while code is being
written — it re-runs `check` on every save of the config, entry, change files,
or snapshots (each run in a fresh process), and stays out of the way when the
surface is clean:

```jsonc
// package.json — adapt to the project's runner
{
  "scripts": {
    "dev": "concurrently -n app,versionless \"next dev\" \"versionless watch\""
  }
}
```

Any equivalent works (`bun run --parallel`, turbo, a procfile) — the invariant
is that `versionless watch` runs whenever the dev server does.

### 5. Gate CI

```yaml
jobs:
  compat:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx versionless check --github   # ::error annotations on the PR
      - run: bunx versionless verify           # fixture + tolerant-reader probes
```

## CLI

```text
versionless <command> [options]

  init       Scaffold versionless.config.ts, the surface entry, and agent docs
  snapshot   Extract the API surface and write .versionless/<version>.json
  check      Diff head vs the last snapshot; fail on uncovered breaking changes
  verify     Run each change's wire-shape fixtures + tolerant-reader probes
  watch      Re-run check whenever the surface, changes, or snapshots change
  generate   Scaffold a change file covering the uncovered diffs
  explain    Show the transform path an old client walks for a route
  changelog  Render the change chain as markdown
  login      Authenticate with the hosted platform
  logout     Remove the stored login
  whoami     Verify the current login
  query      Run project-scoped read-only ClickHouse SQL
```

Every command accepts `--config <path>` and `--json`. Exit codes are the CI
contract: `0` clean/covered, `1` uncovered breaking changes, `2` config/usage
error, `3` extraction failed, `4` snapshot format mismatch, `5` auth failed,
`6` query failed.

### The loop for a breaking change

A breaking change ships in a **new version** — coverage only considers changes
newer than the last snapshot:

1. `versionless check --json` — every uncovered diff comes with the exact
   `schema:` declaration to write.
2. Bump `current` on the instance (e.g. to today) if the head version already
   has a committed snapshot.
3. `versionless generate` — scaffolds `changes/<version>-generated.ts` with
   routes/procedures, the schema declaration, and typed TODO transform bodies
   pre-filled; it self-registers via the `changes:` glob.
4. Fill in `request.up` / `response.down` (pure, total; spread `...rest` so
   the tolerant-reader probe passes), add `examples` fixtures.
5. Re-run `check` (exit 0) and `verify`, run the tests, then
   `versionless snapshot` and commit snapshot + change file together.

Debugging: `versionless explain "GET /users/:id" --version <v>` prints the
effective version, the exact chain-vs-jump transform path, and sunset status —
the ground truth for "why is this client seeing this shape".
`versionless changelog --out CHANGELOG.api.md` renders the chain as markdown.

### query — authenticated telemetry SQL

The standout command: once a project ships telemetry, `query` runs read-only
SQL against the project's live traffic — the same data the dashboard uses —
straight from the terminal or an agent session.

```bash
versionless login     # one-time; `whoami` verifies

versionless query --project <uuid> --sql "
  SELECT LogAttributes['versionless.version'] AS version,
         count() AS requests
  FROM otel_logs
  GROUP BY version ORDER BY requests DESC"
```

Auth and safety: the server resolves the project, verifies your membership in
its owning team, and executes as a dedicated ClickHouse user with `SELECT`
only on `otel_logs` and `otel_traces`; row policies inject the trusted
project/team scope into every scan, so client SQL cannot read across projects.
DDL, writes, system tables, oversized results, and long-running queries are
denied at the database boundary. Flags: `--sql` / `--file` / stdin /
positional, `--params <json>` for bound ClickHouse parameters,
`--timeout <ms>` (1–60s), `--json`, `--server-url <url>`.

What it's good for — every request event carries `versionless.*` attributes
(`versionless.version`, `versionless.version.requested`, `versionless.route`,
`versionless.transform_count`, `versionless.latency_ms`,
`versionless.consumer.key`, `http.response.status_code`), so you can answer
migration questions directly:

```sql
-- Who is still pinned to a version you want to sunset, and how hard?
SELECT LogAttributes['versionless.consumer.key'] AS consumer,
       LogAttributes['versionless.route'] AS route,
       count() AS requests
FROM otel_logs
WHERE LogAttributes['versionless.version'] = {v:String}
GROUP BY consumer, route ORDER BY requests DESC

-- Drift depth: routes whose old clients pay the most transforms
SELECT LogAttributes['versionless.route'] AS route,
       max(toUInt32OrZero(LogAttributes['versionless.transform_count'])) AS depth,
       count() AS requests
FROM otel_logs GROUP BY route ORDER BY depth DESC
```

Run the first query before scheduling a sunset (`--params '{"v":"2025-06-01"}'`),
and after a migration email to watch adoption move.
