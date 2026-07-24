/**
 * The demo's oRPC surface — the same change chain as the HTTP routes, keyed
 * by procedure (`trpc:demo.userList` / `trpc:demo.userCreate`). Input
 * validation reuses the drizzle-zod schema — one parent source.
 */
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import {
  versionlessAdapterInterceptor,
  versionlessClientInterceptor,
  versionlessContext,
} from "@versionless/adapter-orpc";
import { userCreateSchema, userSchema } from "@versionless/db/schema/demo";
import { z } from "zod";
import { addUser, users } from "../data";
// Via versions.ts so the change chain is registered (see handlers.ts).
import { v } from "../versions";

export const rpcRouter = {
  demo: {
    userList: os.output(z.array(userSchema)).handler(() => users),
    userCreate: os
      .input(userCreateSchema)
      .output(userSchema)
      .handler(({ input }) => addUser(input)),
  },
};

const handler = new RPCHandler(rpcRouter, {
  adapterInterceptors: [versionlessAdapterInterceptor(v)], // sunset headers
  clientInterceptors: [versionlessClientInterceptor()], // up/down per procedure
});

/**
 * Handle an RPC request. `prefix` is the mount path as it appears in the
 * request URL — under the /demo base that's "/demo/rpc".
 */
export async function handleRpc(
  request: Request,
  prefix: `/${string}` = "/demo/rpc",
): Promise<Response> {
  const { matched, response } = await handler.handle(request, {
    prefix,
    context: { ...versionlessContext(v, { request }) },
  });
  if (matched && response) return response;
  return Response.json({ error: "not_found" }, { status: 404 });
}
