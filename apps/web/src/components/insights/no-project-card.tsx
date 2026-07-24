import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@versionless/ui/components/empty";
import { FolderPlus } from "lucide-react";

/** Shown until an SDK first registers a named telemetry project. */
export function NoProjectCard() {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderPlus />
        </EmptyMedia>
        <EmptyTitle>No project yet</EmptyTitle>
        <EmptyDescription>
          Add <code className="font-mono">project</code> and an API key to your
          <code className="font-mono"> createVersionless</code> constructor.
          The project appears here as soon as its first telemetry batch arrives.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
