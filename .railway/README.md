# Railway configuration

This project defines its Railway infrastructure in code.

```txt
.railway/railway.ts
```

Use this file to describe the Railway project you want: services, databases, buckets, custom domains, replicas, groups, and environment variables.

## Common commands

Create the configuration files:

```bash
railway config init
```

Import an existing Railway project into code:

```bash
railway config pull
```

Preview what Railway would change:

```bash
railway config plan
```

Apply the planned changes:

```bash
railway config apply
```

## Notes

- `railway config plan` is safe and does not change Railway.
- `railway config apply` previews changes and asks before applying unless you pass `--yes`.
- Destructive changes in non-interactive or agent sessions require `railway config apply --confirm-destructive` after reviewing the plan.
- Services already managed by `railway.json` / `railway.toml` must be migrated before `.railway/railway.ts` can manage them.
- Use `replicas` for scaling; advanced placement can still specify region names.
- Use `group("Name", [resources])` to keep large projects organized on the Railway canvas.
- Secrets imported from Railway are rendered as `preserve()` so existing values are retained without writing secret values to source. Use `railway config pull --omit-preserved-variables` for a smaller import.

## Versionless topology

- `otel-collector` accepts trusted internal OTLP and exports the standard
  `otel_logs` and `otel_traces` tables to ClickHouse.
- `otel-gateway` is the public OTLP boundary. Envoy delegates authorization to
  the Elysia API hosted on Vercel, forwards OTLP/HTTP to the Collector, and
  exposes OTLP/gRPC through a Railway TCP proxy.
- Local Docker Compose and Railway render their Envoy configuration from
  `infra/otel/envoy.template.yaml`. Run `bun run otel:validate` to render and
  validate both deployment topologies with Envoy before changing the gateway.

Generate a Railway service domain for `otel-gateway` (port 4318) after
applying the service-creation plan; generated domains do not belong in this
file.
