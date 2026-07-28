import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@versionless/ui/components/collapsible";
import { Spinner } from "@versionless/ui/components/spinner";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";

import { cn } from "@versionless/ui/lib/utils";
import { workSummary, type WorkStep } from "./work-summary";

function StepIcon({ state }: { state: WorkStep["state"] }) {
  if (state === "running") return <Spinner className="size-3 shrink-0" />;
  if (state === "failed") {
    return <TriangleAlert className="size-3 shrink-0 text-destructive" />;
  }
  return <Check className="size-3 shrink-0 text-muted-foreground" />;
}

function StepRow({ step }: { step: WorkStep }) {
  const store = step.toolName.startsWith("postgres") ? "Postgres" : "ClickHouse";
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <StepIcon state={step.state} />
        <span className="text-muted-foreground">
          {store}
          {step.detail ? ` · ${step.detail}` : ""}
        </span>
      </span>
      {step.sql ? (
        <pre className="ms-4.5 overflow-x-auto whitespace-pre-wrap rounded bg-muted px-1.5 py-1 font-mono text-[0.625rem] text-muted-foreground">
          {step.sql}
        </pre>
      ) : null}
    </li>
  );
}

/**
 * The tool work behind an answer: a live list while the model is running, and
 * a collapsed "Worked for 12s · 4 queries" line once it finishes.
 */
export function WorkTimeline({
  steps,
  streaming,
  durationMs,
}: {
  steps: readonly WorkStep[];
  streaming: boolean;
  durationMs: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  if (streaming) {
    return (
      <ul className="flex flex-col gap-1.5 border-s ps-2.5 text-[0.6875rem]">
        {steps.map((step, index) => (
          <StepRow key={`${step.toolName}-${index}`} step={step} />
        ))}
      </ul>
    );
  }

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        className={cn(
          "flex cursor-pointer items-center gap-1 rounded-sm text-[0.6875rem] text-muted-foreground",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        )}
      >
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
        />
        {workSummary(steps, durationMs)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1.5 flex flex-col gap-1.5 border-s ps-2.5 text-[0.6875rem]">
          {steps.map((step, index) => (
            <StepRow key={`${step.toolName}-${index}`} step={step} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
