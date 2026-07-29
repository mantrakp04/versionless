import type { ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@versionless/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@versionless/ui/components/empty";
import { TriangleAlert } from "lucide-react";

import { clientErrorMessage } from "@/utils/client-error";

export function ClientErrorState({
  error,
  reset,
}: Pick<ErrorComponentProps, "error" | "reset">) {
  return (
    <Empty className="min-h-[24rem]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>We hit a problem</EmptyTitle>
        <EmptyDescription className="max-w-lg whitespace-pre-line">
          {clientErrorMessage(
            error,
            "This page could not be loaded. Please try again.",
          )}
        </EmptyDescription>
        <Button className="mt-2" onClick={reset} type="button">
          Try again
        </Button>
      </EmptyHeader>
    </Empty>
  );
}
