# @versionless/adapter-express

```ts
import { versionless } from "@versionless/adapter-express";

app.use(express.json());   // REQUIRED first — the adapter transforms req.body
app.use(versionless(v));   // before routes; compression() after
```

Route rewrites mutate `req.url` pre-router; response downs patch `res.json`
per-request; telemetry on the finish event. Core's segment matcher identifies
changed routes (Express middleware can't see `req.route`).
