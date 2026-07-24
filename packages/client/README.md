# @versionless/client

Typed SDK: per-version wire types derived from the server's registered change
chain via `ClientTypes` — no codegen.

```ts
import { createClient } from "@versionless/client";
import type { demoApi } from "@versionless/api/demo/versions";

const client = createClient<typeof demoApi, Shapes>()({
  baseUrl: "https://api.example.com",
  version: "2025-06-01",     // pinned; typed against known versions
  apiKey: "key_...",         // consumer key (dashboard grouping)
});

const user = await client.request("GET /users/:id", { params: { id: "u_1" } });
// user is typed as the 2025-06-01 wire shape ({ name }), not the current one
```

`Shapes` supplies current shapes for routes the chain doesn't touch — derive
them from your parent source (e.g. drizzle-zod `z.infer` types), don't
handwrite them. Injectable `fetch` lets tests transport through `app.handle`
in-process (see `apps/server/test/client.test.ts` for the dogfood).
