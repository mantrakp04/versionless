import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@versionless/ui/components/sidebar";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@versionless/ui/components/sonner";

import { AppScrollContainer } from "@/components/app-scroll-container";
import Header from "@/components/header";
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

function RootComponent() {
  return (
    <>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
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
