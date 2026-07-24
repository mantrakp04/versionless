# @versionless/adapter-trpc

Procedure-keyed versioning: changes declare `procedures: ["user.get"]` with
`input: { up }` / `output: { down }`.

```ts
// createContext
return { ...versionlessContext(v, { req }) };

// procedures
const t = initTRPC.context<Context>().create({ errorFormatter: versionlessErrorFormatter(v) });
export const versionedProcedure = t.procedure.use(versionlessMiddleware());

// HTTP envelope (sunset headers)
fetchRequestHandler({ ..., responseMeta: versionlessResponseMeta(v) });
```

Input ups run before `.input()` validation (v11 `getRawInput` override).
Sunset past cutoff → `PRECONDITION_FAILED`. Formatter/responseMeta are
sync-only per tRPC v11; async chains pass through unchanged.
