import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { DefaultChatTransport, type UIMessage } from "ai";
import { env } from "@versionless/env/web";
import { Button } from "@versionless/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@versionless/ui/components/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@versionless/ui/components/input-group";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@versionless/ui/components/message-scroller";
import {
  Message,
  MessageContent,
} from "@versionless/ui/components/message";
import { Bubble, BubbleContent } from "@versionless/ui/components/bubble";
import {
  NativeSelect,
  NativeSelectOption,
} from "@versionless/ui/components/native-select";
import { ArrowUp, Trash2, Square } from "lucide-react";

import { hexclaveClientApp } from "@/hexclave/client";
import { clientErrorMessage } from "@/utils/client-error";
import { getServerUrl } from "@/utils/server-url";
import { MdxMessage } from "./mdx-message";
import { WorkTimeline } from "./work-timeline";
import { toWorkStep, type WorkStep } from "./work-summary";

interface ChatModel {
  id: string;
  name: string;
}

const SUGGESTIONS = [
  "Which consumers are still on an old version?",
  "How has adoption moved over the last 30 days?",
  "What's my p95 latency this week?",
];

function useChatModels() {
  return useQuery<ChatModel[]>({
    queryKey: ["chat-models"],
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const authorization = await hexclaveClientApp.getAuthorizationHeader();
      const response = await fetch(
        `${getServerUrl(env.VITE_SERVER_URL)}/v1/chat/models`,
        { headers: authorization ? { authorization } : {} },
      );
      if (!response.ok) throw new Error("Model list unavailable");
      const body = (await response.json()) as { models?: ChatModel[] };
      return body.models ?? [];
    },
  });
}

/** Text and tool steps of one assistant message, in the order they streamed. */
function readParts(message: UIMessage): { text: string; steps: WorkStep[] } {
  let text = "";
  const steps: WorkStep[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      text += part.text;
      continue;
    }
    const step = toWorkStep(part as Parameters<typeof toWorkStep>[0]);
    if (step) steps.push(step);
  }
  return { text, steps };
}

export function ChatPanel({
  open,
  onOpenChange,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
}) {
  const models = useChatModels();
  const [model, setModel] = useState<string>("");
  const [input, setInput] = useState("");

  useEffect(() => {
    if (model === "" && models.data && models.data.length > 0) {
      setModel(models.data[0]!.id);
    }
  }, [model, models.data]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${getServerUrl(env.VITE_SERVER_URL)}/v1/chat`,
        headers: async (): Promise<Record<string, string>> => {
          const authorization =
            await hexclaveClientApp.getAuthorizationHeader();
          return authorization ? { authorization } : {};
        },
      }),
    [],
  );

  const chat = useChat({
    transport,
    // The route reads the project from the request and re-authorizes it
    // server-side, so this is a hint, not a grant.
    id: projectId,
  });

  // Wall-clock per assistant turn, for the "Worked for …" line. Keyed by
  // message id so an earlier turn keeps the duration it actually took.
  const startedAt = useRef<number | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const streaming = chat.status === "streaming" || chat.status === "submitted";
  const lastMessage = chat.messages.at(-1);

  useEffect(() => {
    if (streaming) {
      startedAt.current ??= performance.now();
      return;
    }
    const started = startedAt.current;
    startedAt.current = null;
    if (started === null || !lastMessage || lastMessage.role !== "assistant") {
      return;
    }
    const elapsed = Math.round(performance.now() - started);
    setDurations((current) =>
      lastMessage.id in current
        ? current
        : { ...current, [lastMessage.id]: elapsed },
    );
  }, [lastMessage, streaming]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "" || streaming) return;
      setInput("");
      void chat.sendMessage(
        { text: trimmed },
        { body: { projectId, ...(model === "" ? {} : { model }) } },
      );
    },
    [chat, model, projectId, streaming],
  );

  const clearChat = useCallback(() => {
    if (streaming) void chat.stop();
    chat.clearError();
    chat.setMessages([]);
    setDurations({});
    startedAt.current = null;
  }, [chat, streaming]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(80svh,44rem)] flex-col gap-3 sm:max-w-2xl">
        <Button
          aria-label="Clear chat"
          className="absolute top-2 right-11 h-8 px-2 text-muted-foreground"
          disabled={chat.messages.length === 0}
          onClick={clearChat}
          size="sm"
          title="Clear chat"
          type="button"
          variant="ghost"
        >
          <Trash2 />
          Clear
        </Button>
        <DialogHeader className="pe-24">
          <DialogTitle>Ask about {projectName}</DialogTitle>
          <DialogDescription>
            Answers come from live queries against this project's telemetry and
            release metadata.
          </DialogDescription>
        </DialogHeader>

        <MessageScrollerProvider autoScroll>
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-4 pe-1">
                {chat.messages.length === 0 ? (
                  <div className="flex flex-col items-start gap-1.5 py-6">
                    <p className="text-muted-foreground text-xs">
                      Try one of these:
                    </p>
                    {SUGGESTIONS.map((suggestion) => (
                      <Button
                        key={suggestion}
                        onClick={() => send(suggestion)}
                        size="sm"
                        variant="outline"
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                ) : null}

                {chat.messages.map((message, index) => {
                  const { text, steps } = readParts(message);
                  const isLast = index === chat.messages.length - 1;
                  const isStreaming = streaming && isLast;

                  if (message.role === "user") {
                    return (
                      <MessageScrollerItem key={message.id}>
                        <Message align="end">
                          <MessageContent>
                            <Bubble align="end">
                              <BubbleContent>{text}</BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    );
                  }

                  return (
                    <MessageScrollerItem key={message.id}>
                      <Message>
                        <MessageContent className="gap-2">
                          <WorkTimeline
                            durationMs={durations[message.id] ?? null}
                            steps={steps}
                            streaming={isStreaming}
                          />
                          {text.trim() === "" ? null : (
                            <Bubble
                              className="w-full max-w-full"
                              variant="ghost"
                            >
                              <BubbleContent className="w-full">
                                <MdxMessage
                                  projectId={projectId}
                                  streaming={isStreaming}
                                  text={text}
                                />
                              </BubbleContent>
                            </Bubble>
                          )}
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  );
                })}

                {chat.error ? (
                  <p className="text-destructive text-xs">
                    {clientErrorMessage(
                      chat.error,
                      "The assistant could not answer that. Try again.",
                    )}
                  </p>
                ) : null}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
        >
          <InputGroup>
            <InputGroupTextarea
              aria-label="Ask a question"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about versions, consumers, latency…"
              rows={2}
              value={input}
            />
            <InputGroupAddon align="block-end">
              <ModelPicker
                models={models.data ?? []}
                onChange={setModel}
                value={model}
              />
              <div className="ms-auto">
                {streaming ? (
                  <InputGroupButton
                    aria-label="Stop"
                    onClick={() => chat.stop()}
                    size="icon-xs"
                    type="button"
                  >
                    <Square />
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    aria-label="Send"
                    disabled={input.trim() === ""}
                    size="icon-xs"
                    type="submit"
                    variant="default"
                  >
                    <ArrowUp />
                  </InputGroupButton>
                )}
              </div>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: ChatModel[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (models.length === 0) {
    return (
      <span className="text-[0.625rem] text-muted-foreground">
        Default model
      </span>
    );
  }
  return (
    <NativeSelect
      aria-label="Model"
      onChange={(event) => onChange(event.target.value)}
      size="sm"
      value={value}
    >
      {models.map((entry) => (
        <NativeSelectOption key={entry.id} value={entry.id}>
          {entry.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
