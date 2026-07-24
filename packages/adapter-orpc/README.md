# @versionless/adapter-orpc

```ts
import {
  versionlessContext,
  versionlessClientInterceptor,
  versionlessAdapterInterceptor,
} from "@versionless/adapter-orpc";

const handler = new RPCHandler(router, {
  adapterInterceptors: [versionlessAdapterInterceptor(v)],       // sunset headers
  clientInterceptors: [versionlessClientInterceptor()],   // up/down per procedure
});

handler.handle(request, {
  context: { ...versionlessContext(v, { request }) },
});
```

Procedure-keyed changes (`procedures: ["user.create"]`), like the tRPC
adapter. The client interceptor runs after input decoding and before output
encoding — `up` on the decoded input, `down` on the output, `error.down` on
thrown `ORPCError`s.
