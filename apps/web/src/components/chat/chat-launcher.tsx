import { useState } from "react";
import { Button } from "@versionless/ui/components/button";
import { Sparkles } from "lucide-react";

import { useInsightsContext } from "@/hooks/use-insights-context";
import { ChatPanel } from "./chat-panel";

/**
 * Support-widget launcher for the insights routes. It sits one row above the
 * development-only tools so those fixed controls cannot cover its hit target.
 */
export function ChatLauncher() {
  const { project } = useInsightsContext();
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  const openChat = () => {
    setHasOpened(true);
    setOpen(true);
  };

  return (
    <>
      <Button
        aria-label="Ask about this project"
        className="fixed right-4 bottom-20 z-40 size-11 rounded-full shadow-lg"
        onClick={openChat}
        size="icon"
        title="Ask about this project"
      >
        <Sparkles />
      </Button>
      {/* Lazy on first use, then kept mounted so closing the dialog behaves
          like hiding a window: the transcript survives until page reload. */}
      {hasOpened ? (
        <ChatPanel
          onOpenChange={setOpen}
          open={open}
          projectId={project.id}
          projectName={project.name}
        />
      ) : null}
    </>
  );
}
