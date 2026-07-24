# @versionless/otel

OpenTelemetry bridge for versionless — spans every step of the versioning
pipeline, Prisma-instrumentation style.

```ts
import { createVersionless } from "@versionless/core";
import { otelTracing } from "@versionless/otel";

export const v = createVersionless({
  scheme: "date",
  current: "2026-07-21",
  resolve: [{ header: "x-api-version" }, { default: "current" }],
  tracing: otelTracing(),
});
```

Every request produces a `versionless.exchange` root span (parented under the
framework's active HTTP span), with `versionless.resolve` and one
`versionless.transform.up|down|error` child per registered change that runs.
Transform spans are the active context while the transform executes, so
instrumented user code inside a transform (fetch, DB) nests correctly.

`@opentelemetry/api` is a peer dependency; without a registered SDK the
bridge is a no-op. Core itself never depends on OTel — `tracing` is a
zero-dep structural interface.
