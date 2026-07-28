import { Suspense } from "react";
import { useUser } from "@hexclave/react";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  Outlet,
  createRootRouteWithContext,
  useLocation,
} from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@versionless/ui/components/sidebar";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@versionless/ui/components/sonner";

import { AppScrollContainer } from "@/components/app-scroll-container";
import Header from "@/components/header";
import Loader from "@/components/loader";
import { ThemeProvider } from "@/components/theme-provider";
import type { trpc } from "@/utils/trpc";

import "../index.css";

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
});

/**
 * The dashboard has no public surface: every route reads team-scoped data.
 * Gating here suspends the whole shell and hands signed-out visitors to the
 * local Hexclave handler instead of rendering empty "sign in" placeholders.
 */
function AuthenticatedApp() {
  useUser({ or: "redirect" });

  return (
    <SidebarProvider>
      <Header />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:hidden">
          <SidebarTrigger />
          <img
            src="/versionless-logo.svg"
            alt=""
            aria-hidden="true"
            className="h-5 w-auto dark:invert"
          />
          <span className="sr-only">versionless</span>
        </header>
        <AppScrollContainer>
          <Outlet />
        </AppScrollContainer>
      </SidebarInset>
    </SidebarProvider>
  );
}

function RootOutlet() {
  const isHexclaveHandler = useLocation({
    select: (location) =>
      location.pathname === "/handler" ||
      location.pathname.startsWith("/handler/"),
  });

  return isHexclaveHandler ? <Outlet /> : <AuthenticatedApp />;
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
        <Suspense fallback={<Loader />}>
          <RootOutlet />
        </Suspense>
        <Toaster richColors />
      </ThemeProvider>
      <TanStackRouterDevtools
        position="bottom-right"
        toggleButtonProps={{ style: { bottom: 80, right: 16 } }}
      />
      <div className="fixed right-16 bottom-4 z-50">
        <ReactQueryDevtools position="bottom" buttonPosition="relative" />
      </div>
    </>
  );
}
