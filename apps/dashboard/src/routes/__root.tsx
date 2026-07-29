import { Suspense, lazy, useEffect } from "react";
import { SignIn, useUser } from "@hexclave/react";
import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useMatches,
} from "@tanstack/react-router";
import { Toaster } from "@versionless/ui/components/sonner";

import { AppShellSkeleton } from "@/components/loader";
import { ThemeProvider } from "@/components/theme-provider";
import type { trpc } from "@/utils/trpc";

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
});

const AuthenticatedApp = lazy(() => import("@/components/authenticated-app"));
// Deliberately import.meta.env, not @versionless/env/vite: Vite replaces the
// literal at build time, so production builds drop the dev-tools chunk
// entirely — a runtime env read would keep it in the bundle output.
const DevelopmentTools = import.meta.env.DEV
  ? lazy(() => import("@/components/development-tools"))
  : null;

/**
 * The dashboard has no public surface: every route reads team-scoped data.
 * Gating here suspends the whole shell and renders the local Hexclave sign-in
 * surface without adding an avoidable client-side navigation.
 */
function AuthenticatedGate() {
  const user = useUser({ includeRestricted: true });

  if (!user || user.isRestricted) {
    return (
      <main className="min-h-svh">
        <SignIn fullPage automaticRedirect />
      </main>
    );
  }

  return <AuthenticatedApp />;
}

function ReadyBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const shell = document.getElementById("bootstrap-shell");
    shell?.setAttribute("aria-hidden", "true");
    shell?.classList.add("bootstrap-shell--ready");
  }, []);

  return children;
}

function RootOutlet() {
  const isHexclaveHandler = useMatches({
    select: (matches) => matches.some((match) => match.routeId === "/handler/$"),
  });

  return isHexclaveHandler ? (
    <ReadyBoundary>
      <main className="min-h-svh">
        <Outlet />
      </main>
    </ReadyBoundary>
  ) : (
    <ReadyBoundary>
      <AuthenticatedGate />
    </ReadyBoundary>
  );
}

function RootComponent() {
  return (
    <>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <Suspense fallback={<AppShellSkeleton />}>
          <RootOutlet />
        </Suspense>
        <Toaster richColors />
      </ThemeProvider>
      {DevelopmentTools ? (
        <Suspense fallback={null}>
          <DevelopmentTools />
        </Suspense>
      ) : null}
    </>
  );
}
