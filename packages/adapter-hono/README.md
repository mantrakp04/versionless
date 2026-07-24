# @versionless/adapter-hono

```ts
import { versionless, versionlessRewrites } from "@versionless/adapter-hono";

app.use("*", versionless(v));
versionlessRewrites(v, app); // alias routes for `rewrite:` changes
```

Reads the matched pattern from `c.req.matchedRoutes`; replaces `c.req.raw`
with the up-transformed request (bodyLimit pattern, bodyCache cleared) and
swaps `c.res` for the down-transformed response. JSON < 1MB only.
