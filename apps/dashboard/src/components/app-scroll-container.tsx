import type { ComponentProps } from "react";

import { cn } from "@versionless/ui/lib/utils";

export function AppScrollContainer({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="app-scroll-container"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable",
        className,
      )}
      {...props}
    />
  );
}
