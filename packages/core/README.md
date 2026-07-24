# @versionless/core

The engine: change registry, transform pipeline compiler (chained changes +
jump priority), route matcher, version resolvers, sunsets (RFC 8594/9745),
telemetry hub (console + OTLP/HTTP logs and traces), and the type-level `ClientTypes`
derivation. Zero runtime dependencies.

Adapters talk to core through one entry point — `openExchange()` — which
returns the per-request `{ up, down, downError, finish, ... }` closures bound
to a precompiled pipeline. See the docs app (`/docs`) for the full guide.
