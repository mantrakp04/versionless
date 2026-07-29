# AGENTS.md

## Purpose

Versionless exists so APIs — and preferably the rest of the codebase — do
**not** accumulate fallbacky or hacky compatibility behavior. Handlers,
schemas, and domain code speak **one current shape**. Old clients stay
compatible through registered `up`/`down` transforms at the edge, not through
dual-field payloads, forever-optional migration fields, versioned route forks,
`if (oldShape)` branches, or tolerant parsing that papers over breakages.

When changing a wire surface: register a change, cover it with
`versionless check`, and keep the current handler honest. Do not "just make
it work" by leaving both shapes in the API or the app.

## Task Completion Requirements

- Keep local verification focused on the files and packages changed. Run the smallest relevant test set; do not run the full workspace test suite as a routine completion step.
  - Use `bun test <test-files>` for focused tests (e.g. `bun test packages/core/test/matcher.test.ts`), or `bun test` from within the affected package directory. Type-level tests (`*.test-d.ts`, e.g. the `ClientTypes` suite) are exercised by the package's `check-types` script, not `bun test`.
  - Changes to `packages/core`, an adapter, the CLI, or `apps/server` behavior must include and run focused tests for the changed behavior. Core and adapter changes ripple: also run the tests of packages that consume what you changed (e.g. a core pipeline change → run the affected adapter's tests too).
  - Run the affected package's type check when available: `bun run check-types` inside the package (or `turbo run check-types -F <package>` from the root; `apps/docs` uses `types:check`).
- Do not run repo-wide `bun run test`, `bun run check-types`, `bun run build`, or equivalent full-suite Turbo commands locally unless the user explicitly requests them. CI is responsible for the full verification suite (see `.github/workflows/ci.yml`).
- After frontend feature development or any user-visible change to `apps/dashboard`, `apps/landing`, or `apps/docs`, the primary agent must run one integrated verification pass after integrating the work:
  - Start the local stack (`bun start-deps` — Postgres, ClickHouse, OTel Collector/gateway) and the needed apps (`bun dev:server` on :3000, `bun dev:dashboard` on :3001 under `/dashboard`, `apps/docs` on :3002, `apps/demo` on :3003 under `/demo`, `bun dev:landing` on :3004); seed telemetry with `bun run --cwd apps/server seed` if the insights views need data. (`bun restart-deps && bun dev` gives a fresh-DB integrated run.)
  - Use the `agent-browser` skill to verify the affected flow in a controlled browser (e.g. <http://localhost:3001/dashboard/insights>). But if u have inbuild browser prefer that.
  - For versioning-behavior changes, also verify the wire behavior directly, e.g. `curl -H 'x-api-version: 2025-01-01' :3003/demo/users/u_1` against the current shape.
  - Subagents must not independently launch dev servers or repeat integrated client verification unless their delegated task explicitly requires it.
  - Stop dev servers, watchers, and containers started for verification when the focused verification is complete (`bun stop-deps`).

## Client Error Safety

- Treat every browser-rendered error, toast, fallback, and API error payload as
  public. Production clients must receive only concise, user-friendly copy;
  never expose exception messages, stack traces, database or service details,
  credentials, personal data, internal URLs, environment variables, or local
  operator commands.
- Keep diagnostics in server logs. In development only, show the friendly
  message together with the actual diagnostic so local failures remain
  actionable. Add focused tests that prove production output is scrubbed and
  development output contains both messages.
- Apply this rule at both boundaries: sanitize server responses before they
  reach the browser, then use the shared client error presenter for route
  errors, query/mutation errors, toasts, and inline fallbacks. Do not render
  raw `error.message` or rely on framework default error components.
- Observability UI is not exempt: production may expose safe error/status
  flags, but raw exception text and attributes must stay server-side unless
  each returned field is explicitly allowlisted as non-sensitive.

## Dashboard Scale and Performance

- Design every dashboard table, chart, sheet, and query for high-cardinality
  production data, not only the small happy path. Seed heavy-tail distributions
  with repeat offenders at 1,000+ occurrences, varied latencies, and enough
  long-tail rows to expose rendering and query-shape regressions.
- Aggregate in ClickHouse and return only the fields the current view renders.
  Bound trace IDs or entity keys before joining wide span/log rows; filter both
  sides of joins by the selected time window and signature; never fetch every
  occurrence or serialize raw attribute maps for a detail view.
- Keep initial UI work bounded: virtualize or paginate long tables, cap chart
  series to a meaningful top-N, lazy-load drill-down detail, reuse React Query
  cache entries, and show dimensionally stable skeletons while data loads.
- Validate performance at the real boundary after material changes: run the
  query as the restricted ClickHouse user, inspect rows/bytes/elapsed time, and
  browser-check the seeded high-volume state for responsive scrolling, opening,
  sorting, and sheet navigation.

## Package Roles

- `packages/core`: The heart of versionless — version graph/registry, request/response transform pipelines, route matching, date-scheme resolver, sunsets, telemetry, `ClientTypes`. Zero runtime deps; keep it framework-agnostic.
- `packages/adapter-elysia` / `-hono` / `-express` / `-nextjs` / `-tanstack-start` / `-trpc` / `-orpc`: Thin (~100 LOC) framework adapters over core. Behavior belongs in core; adapters only translate framework request/response surfaces.
- `packages/cli`: `versionless snapshot / check / generate / explain / changelog / init` — Zod surface diffing and missing-compat detection for CI.
- `packages/client`: Typed client SDK built on core's `ClientTypes`.
- `infra/otel`: Envoy authorization gateway plus the standard OpenTelemetry Collector ClickHouse exporter. Keep OTLP codecs, batching, retries, and storage schema out of application code.
- `packages/db`: Drizzle + PostgreSQL schema and migrations (`bun db:push` / `db:generate` / `db:migrate` / `db:studio` from the root).
- `packages/api`: tRPC routers/context shared by server and web.
- `packages/env`: Typed environment schemas (`server.ts`, `web.ts`). `packages/config`: shared tsconfig. `packages/ui`: shared React components/hooks/styles. Keep env/config schema-and-config-only — no runtime logic.
- `apps/demo`: TanStack Start + oRPC demo app, served under the `/demo` base path (client AND server routes). Owns the demo change chain (`src/versions.ts`, `src/changes/`), the in-memory demo data, the CLI surface entry (`src/surface.ts` — oRPC extractor + `manual` declarations), and an unauthenticated button page simulating versioned usage. Its telemetry key belongs to the Hexclave "demo" team.
- `apps/server`: Elysia + tRPC cloud server (Collector authorization in `src/ingest.ts`, query plane, dashboard tRPC). Dogfoods versionless on its own service API via `@versionless/api/versionless`; its telemetry key belongs to the owner's team.
- `apps/dashboard`: Vite/React 19/TanStack Router insights dashboard (adoption, drift, blockers), served under the `/dashboard` base path (Vite `base` + router `basepath`). Release metadata (versions, sunsets, current) comes from each project's uploaded `versionless snapshot` data via `src/hooks/use-project-releases.ts` — never from hardcoded app constants.
- `apps/landing`: Next.js marketing/landing site served at `/` (owns root SEO: metadata, `robots.txt`, `sitemap.xml`). Static, no env or backend dependencies; uses `assetPrefix: "/landing"` so its `/_next` assets don't collide with `apps/docs`.
- `apps/docs`: fumadocs (Next.js) documentation site.

## Database Changes

The drizzle schema (`packages/db/src/schema/`) is the **parent source of the
API wire types** (drizzle-zod → `z.infer` → surface extraction), so a DB
change is an API change until proven otherwise. Every schema change follows
this sequence — CI's `db-compat` job enforces each step:

1. **Edit the schema**, then `bun db:generate` — the migration SQL in
   `packages/db/src/migrations/` is committed alongside the schema change. CI
   re-generates and fails on drift (schema change without a migration).
2. **Keep the migration compatible** — `bun run db:check` lints the SQL
   against expand → backfill → contract rules: no `DROP COLUMN`/`DROP TABLE`/
   `RENAME`/type changes/`ADD COLUMN ... NOT NULL` without `DEFAULT`/
   `SET NOT NULL`/destructive DML. A legitimate contract step gets a
   `-- compat:allow <reason>` waiver comment on the statement (the reason is
   mandatory and reviewed).
3. **Migrations must be idempotent** — CI applies them twice against fresh
   Postgres and ClickHouse. Dev keeps the `bun db:push` loop; deploys opt in
   with `RUN_MIGRATIONS=true` (applied once at startup via
   `@versionless/db/migrate`, journaled, race-safe).
4. **`versionless check` must pass** — if the schema change ripples into the
   wire surface, cover it with a registered change (`v.change` with
   `request.up`/`response.down` + `schema` declaration) before it lands. Run
   `bun run versionless:check` from the root; add `examples` fixtures so
   `versionless verify` exercises the transforms.

## Seed Data

- `apps/server/scripts/seed-traffic.ts` (`bun run --cwd apps/server seed`) is the only source of dashboard preview data on dev — keep it truthful. Whenever a change touches storage or the wire surface — a DB schema change, an endpoint/route added, modified, or removed, a new API version or sunset, or a change to ingest/telemetry event fields — update the seed script in the same change so the seeded story exercises the new surface (its `ROUTES` list, version set, consumer mix, and event fields must reflect reality), then re-run the seed and confirm the insights UI renders it.
- The seed resolves its team from `DEMO_VERSIONLESS_API_KEY` first, so synthetic demo traffic follows the same Hexclave `demo` team as real `apps/demo` traffic. `SEED_TEAM_ID` is only the trusted local-Collector fallback, then `"demo"` as a hidden local placeholder. With `VERSIONLESS_OTLP_LOGS_URL` plus the demo key, seed through the authenticated gateway; new seed knobs go through `@versionless/env/server`, never raw `process.env`.

## References

- `skills/versionless/SKILL.md` is the canonical agent-facing description of every versionless surface; it fetches live instructions from <https://skill.versionless.com>. Prefer it over memory when working on versioning semantics.
- The design follows Stripe's date-based API versioning model (rolling versions as chains of reversible transforms). Use Stripe's public writing on API versioning as the conceptual reference when designing change semantics, sunset behavior, and migration flows.
