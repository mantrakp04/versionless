import { QueryCache, QueryClient } from "@tanstack/react-query";
import { TRPCClientError, createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@versionless/api/routers/index";
import { env } from "@versionless/env/web";
import { toast } from "sonner";

import { hexclaveClientApp } from "@/hexclave/client";
import { clientErrorMessage } from "@/utils/client-error";
import { isProjectQueryUnavailable } from "@/utils/project-query";
import { getServerUrl } from "@/utils/server-url";
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Production renders telemetry-store failures inline without a duplicate
      // toast. Development keeps the toast so the actual diagnostic remains
      // visible even for components with a fixed inline fallback.
      if (
        ((error instanceof TRPCClientError &&
          (error.data as { code?: string } | null | undefined)?.code ===
            "PRECONDITION_FAILED") ||
          isProjectQueryUnavailable(error)) &&
        !env.DEV
      ) {
        return;
      }
      toast.error(
        clientErrorMessage(
          error,
          "We could not load this data. Please try again.",
        ),
        {
          action: {
            label: "retry",
            onClick: () => {
              query.invalidate();
            },
          },
        },
      );
    },
  }),
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getServerUrl(env.VITE_SERVER_URL)}/trpc`,
      // Hexclave session tokens ride along so the server can resolve the
      // user (protectedProcedure); empty when signed out.
      headers: async () => {
        const authorization = await hexclaveClientApp.getAuthorizationHeader();
        return authorization ? { authorization } : {};
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
