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
loop against itself), `apps/web` (insights dashboard), `apps/docs` (fumadocs).

## Quickstart (this repo)

```bash
bun install
bun start-deps      # postgres + clickhouse + OTel Collector/gateway
bun run --cwd apps/server seed    # 30 days of synthetic telemetry
bun dev             # server :3000, web :3001, docs :3002
```

Try the versioning:

```bash
curl :3000/users/u_1                              # current shape: firstName/lastName
curl -H 'x-api-version: 2025-01-01' :3000/users/u_1   # old shape: name
curl -H 'x-api-version: 2025-01-01' :3000/orgs/t_1    # rewritten to /teams/:id
curl -sD - -o /dev/null -H 'x-api-version: 2025-01-01' :3000/users/u_1 | grep -iE 'sunset|deprecation'
```

Dashboard: <http://localhost:3001/insights> · Docs: <http://localhost:3002/docs>

## Checks

```bash
bun run check-types   # includes the type-level ClientTypes test suite
bun run test          # bun test across all packages (turbo)
```

## Stack

Bun workspaces + Turborepo · Elysia + tRPC server · Vite/React 19/TanStack
Router web · Drizzle + PostgreSQL · ClickHouse (telemetry) · fumadocs ·
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
