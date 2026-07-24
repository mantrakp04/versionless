# @versionless/adapter-nextjs

```ts
// app/users/[id]/route.ts
import { versionless } from "@versionless/adapter-nextjs";

export const { GET, PATCH } = versionless(v, {
  GET: async (req, ctx) => Response.json(...),
  PATCH: async (req, ctx) => Response.json(...),
}, { route: "/users/[id]" });
```

Wraps App Router route handlers per file (no global body-transforming
middleware exists in Next). `route` is optional — without it core matches the
raw path. Rewrites get alias route files via `versionlessAlias(v, target)`.
JSON < 1MB only.
