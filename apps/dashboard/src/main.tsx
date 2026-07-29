import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { HexclaveProvider, HexclaveTheme } from "@hexclave/react";
import { Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";

import { dismissBootstrapShell } from "./bootstrap";
import { ClientErrorState } from "./components/client-error-state";
import Loader, { AppShellSkeleton } from "./components/loader";
import { hexclaveClientApp } from "./hexclave/client";
import { routeTree } from "./routeTree.gen";
import { queryClient, trpc } from "./utils/trpc";

const router = createRouter({
  routeTree,
  basepath: "/dashboard",
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultErrorComponent: ClientErrorState,
  defaultPendingComponent: () => <Loader />,
  context: { trpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return (
      <Suspense fallback={<AppShellSkeleton />}>
        <HexclaveProvider app={hexclaveClientApp}>
          <HexclaveTheme>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          </HexclaveTheme>
        </HexclaveProvider>
      </Suspense>
    );
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

function DashboardRoot() {
  useEffect(() => {
    dismissBootstrapShell(document);
  }, []);

  return <RouterProvider router={router} />;
}

void import("./index.css").then(() => {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<DashboardRoot />);
});
