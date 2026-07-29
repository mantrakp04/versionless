import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export default function DevelopmentTools() {
  return (
    <>
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
