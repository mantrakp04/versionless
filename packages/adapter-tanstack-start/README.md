# @versionless/adapter-tanstack-start

```ts
// routes/users/$id.ts
import { versionless } from "@versionless/adapter-tanstack-start";

export const Route = createFileRoute("/users/$id")({
  server: {
    handlers: versionless(v, {
      GET: async ({ request, params }) => Response.json(...),
    }, { route: "/users/$id" }),
  },
});
```

Wraps server route handlers per file (request middleware can't swap the body
a handler reads). `route` is optional — without it core matches the raw path.
Rewrites get alias route files via `versionlessAlias(v, target)`. JSON < 1MB
only.
