# versionless

**Stripe's date-based API versioning as a library.** Handlers only ever speak
the *latest* wire shape; versions are a chain of reversible transforms applied
at the edge. No v1/v2 route forks, ever.

```
request (pinned 2025-05-14)
  → up(change₁) → up(change₂) → ... → handler sees CURRENT shape
  → handler returns CURRENT shape
  → down(changeₙ) → ... → down(change₁) → response in 2025-05-14 shape
```

```ts
v.change("2026-05-14", {
  describe: "user.name split into firstName/lastName",
  routes: ["GET /users/:id", "POST /users"],
  request:  { up:   ({ name, ...r }: { name: string }) => ({ ...r, ...split(name) }) },
  response: { down: ({ firstName, lastName, ...r }) => ({ ...r, name: `${firstName} ${lastName}` }) },
  schema: (s) => s.on("User", { removed: ["name"], added: ["firstName", "lastName"] }),
});
```

## Packages

| Package | What it is |
| --- | --- |
| `@versionless/core` | Version graph, transform pipelines, route matching, resolvers, sunsets, telemetry. Zero runtime deps. |
| `@versionless/adapter-elysia` · `-hono` · `-express` · `-nextjs` · `-tanstack-start` · `-trpc` · `-orpc` | Thin adapters (~100 LOC each) over one core. |
| `@versionless/cli` | `versionless snapshot / check / verify / generate / explain / changelog / init` — missing-compat detection and transform-integrity fixtures in CI. |
| OpenTelemetry Collector | Standard OTLP/HTTP + gRPC ingestion and ClickHouse export (`otel_logs`, `otel_traces`). |

Plus the demo/cloud apps: `apps/server` (Elysia + tRPC, dogfoods the whole
loop against itself), `apps/dashboard` (insights dashboard, served under
`/dashboard`), `apps/landing` (Next.js marketing site at `/`), `apps/docs`
(fumadocs).

## Quickstart (this repo)

```bash
bun install
bun start-deps      # postgres + clickhouse + OTel Collector/gateway
bun run --cwd apps/server seed    # 30 days of synthetic telemetry
bun dev             # server :3000, dashboard :3001, docs :3002, landing :3004
```

Set `PORT_PREFIX` to move the whole stack onto another block — see
[Running several checkouts at once](#running-several-checkouts-at-once).

Try the versioning:

```bash
curl :3000/users/u_1                              # current shape: firstName/lastName
curl -H 'x-api-version: 2025-01-01' :3000/users/u_1   # old shape: name
curl -H 'x-api-version: 2025-01-01' :3000/orgs/t_1    # rewritten to /teams/:id
curl -sD - -o /dev/null -H 'x-api-version: 2025-01-01' :3000/users/u_1 | grep -iE 'sunset|deprecation'
```

Dashboard: <http://localhost:3001/dashboard/insights> · Docs: <http://localhost:3002/docs> · Landing: <http://localhost:3004>

## Running several checkouts at once

Every port the stack binds — apps *and* the docker-compose services — is
`PORT_PREFIX` (default `30`) plus a fixed two-digit offset, so a worktree can
take a whole block of its own:

```bash
export PORT_PREFIX=$(bun run --silent port-prefix)   # first block nothing is holding
bun start-deps          # postgres :3105, clickhouse :3106/:3107, OTLP :3108/:3109
bun dev                 # server :3100, dashboard :3101, docs :3102, demo :3103, landing :3104
```

`bun run port-prefix --list` shows which blocks are taken and by what. Export
the prefix once — docker compose, turbo, the dev servers, the seed script, and
`bun db:studio` all read it from the environment, and `bun stop-deps` tears
down only that block's containers.

| offset | service | offset | service |
| --- | --- | --- | --- |
| `00` | `apps/server` | `06` | clickhouse HTTP |
| `01` | `apps/dashboard` | `07` | clickhouse native |
| `02` | `apps/docs` | `08` | OTLP gateway gRPC |
| `03` | `apps/demo` | `09` | OTLP gateway HTTP |
| `04` | `apps/landing` | `10` | Collector (seed-only, loopback) |
| `05` | postgres | `11` | Envoy admin |
| | | `12` | `bun db:studio` |

The prefix also names the compose project (`versionless-31`), so containers,
networks, and volumes are per-checkout rather than shared — each worktree gets
its own database. `packages/env/src/ports.ts` owns the table; the ports live
nowhere else. Prefixes are two digits, `10`–`99`.

## Checks

```bash
bun run check-types   # includes the type-level ClientTypes test suite
bun run test          # bun test across all packages (turbo)
```

## Stack

Bun workspaces + Turborepo · Elysia + tRPC server · Vite/React 19/TanStack
Router dashboard · Next.js landing · Drizzle + PostgreSQL · ClickHouse (telemetry) · fumadocs ·
deployed via Vercel (`vercel.json`; see `bun run deploy:*`).

Local stack: `bun start-deps` / `stop-deps` / `restart-deps`. Schema scripts:
`bun db:push` / `db:studio` / `db:generate` / `db:migrate` / `db:check`.
Schema changes ship as committed drizzle migrations: `bun db:generate` (SQL +
journal), `bun run db:check` (expand/contract compat lint), `db:migrate`
(idempotent). CI's `db-compat` job applies migrations twice against fresh
Postgres and requires `versionless check` to pass; after those checks pass on
`main`, `migrate-production` applies the committed migrations using the
`DATABASE_URL` secret available to the GitHub `Production` environment. A DB
change is an API change until proven otherwise (see AGENTS.md → Database
Changes).
Env sync for deploys: `bun run env:preview` / `env:production` (see
`scripts/sync-vercel-env.ts`).
