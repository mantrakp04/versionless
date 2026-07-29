# @versionless/cli

The Versionless CLI snapshots an API surface, detects breaking changes, checks
that each change has a registered compatibility transform, and verifies
wire-shape fixtures.

Versionless requires [Bun](https://bun.sh/).

## Install

```sh
bun add --dev @versionless/cli
bunx versionless init
```

## Commands

```sh
versionless snapshot
versionless check
versionless verify
versionless generate
versionless explain
versionless changelog
```

See the [Versionless repository](https://github.com/mantrakp04/versionless) for
documentation and examples.
