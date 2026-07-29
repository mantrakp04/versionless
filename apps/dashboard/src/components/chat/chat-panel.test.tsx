import { expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let mockMessages: UIMessage[] = [];

mock.module("@ai-sdk/react", () => ({
  useChat: () => ({
    clearError: () => {},
    error: null,
    messages: mockMessages,
    sendMessage: () => Promise.resolve(),
    setMessages: () => {},
    status: "ready",
    stop: () => {},
  }),
}));

function Dialog({
  children,
}: {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return <>{children}</>;
}

function DialogPart({
  children,
  ...props
}: ComponentProps<"div">) {
  return <div {...props}>{children}</div>;
}

mock.module("@versionless/ui/components/dialog", () => ({
  Dialog,
  DialogContent: DialogPart,
  DialogDescription: DialogPart,
  DialogHeader: DialogPart,
  DialogTitle: DialogPart,
}));

const { ChatPanel } = await import("./chat-panel");

test("renders the chat transcript inside its message scroller provider", () => {
  const queryClient = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ChatPanel
        onOpenChange={() => {}}
        open
        projectId="project-1"
        projectName="Example"
      />
    </QueryClientProvider>,
  );

  expect(html).toContain('data-slot="message-scroller"');
  expect(html).toContain('data-slot="message-scroller-viewport"');
  expect(html).toContain("Try one of these:");
  expect(html).toContain('aria-label="Clear chat"');
  expect(html).toContain("disabled");
  expect(html).not.toContain('aria-label="Model"');
  expect(html).not.toContain("Default model");
});

test("assistant dashboards receive the full transcript width", () => {
  mockMessages = [
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "# Adoption" }],
    },
  ];
  const queryClient = new QueryClient();

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ChatPanel
        onOpenChange={() => {}}
        open
        projectId="project-1"
        projectName="Example"
      />
    </QueryClientProvider>,
  );

  const bubbleClass = html.match(
    /data-slot="bubble"[^>]*class="([^"]*)"/,
  )?.[1];
  const contentClass = html.match(
    /data-slot="bubble-content"[^>]*class="([^"]*)"/,
  )?.[1];

  expect(bubbleClass?.split(" ")).toContain("w-full");
  expect(bubbleClass?.split(" ")).not.toContain("w-fit");
  expect(contentClass?.split(" ")).toContain("w-full");
  expect(contentClass?.split(" ")).not.toContain("w-fit");
  mockMessages = [];
});
