import { Outlet } from "@tanstack/react-router";
import { env } from "@versionless/env/vite";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@versionless/ui/components/sidebar";

import { AppScrollContainer } from "@/components/app-scroll-container";
import Header from "@/components/header";

export default function AuthenticatedApp() {
  return (
    <SidebarProvider>
      <Header />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:hidden">
          <SidebarTrigger />
          <img
            src={`${env.BASE_URL}versionless-logo.svg`}
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
