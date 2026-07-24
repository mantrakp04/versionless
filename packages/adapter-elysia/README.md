# @versionless/adapter-elysia

```ts
import { versionless, versionlessRewrites } from "@versionless/adapter-elysia";

const app = new Elysia().use(versionless(v)).use(routes);
versionlessRewrites(v, app); // alias routes for `rewrite:` changes
```

Up-transforms run pre-validation (schemas validate the current shape), downs
in afterHandle, error downs on error responses, sunset headers everywhere,
410 past cutoff, one telemetry event per request. JSON bodies < 1MB only;
streams pass through.
