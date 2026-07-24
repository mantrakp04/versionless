import type { ServerUser } from "@hexclave/js";
import { versionlessContext, type VersionlessContext } from "@versionless/adapter-trpc";
import type { Context as ElysiaContext } from "elysia";
import { getHexclaveServerApp } from "./lib/hexclave";
import { v } from "./versionless";

export type CreateContextOptions = {
  context: ElysiaContext;
};

export async function createContext({ context }: CreateContextOptions) {
  // Lazy + memoized: at most one Hexclave lookup per HTTP request no matter
  // how many procedures a batch contains, and zero when only public
  // procedures run.
  let user: Promise<ServerUser | null> | undefined;
  return {
    getUser: (): Promise<ServerUser | null> => {
      user ??=
        getHexclaveServerApp()?.getUser({ tokenStore: context.request }) ??
        Promise.resolve(null);
      return user;
    },
    // Stash for the versionless tRPC middleware (per-procedure transforms).
    ...versionlessContext(v, { req: context.request }),
  } satisfies { getUser: () => Promise<ServerUser | null> } & VersionlessContext;
}

export type Context = Awaited<ReturnType<typeof createContext>>;
