import { compile, run } from "@mdx-js/mdx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactDOM from "react-dom/client";
import * as runtime from "react/jsx-runtime";
import type { MDXContent } from "mdx/types";
import { env } from "@versionless/env/vite";

import "@/index.css";
import { remarkSandboxPolicy } from "./mdx-sandbox-policy";
import { normalizeAssistantMdx } from "./normalize-assistant-mdx";
import { createMdxComponents } from "./registry";
import { createSandboxQueryClient } from "./sandbox-query-client";
import {
  CHAT_SANDBOX_CHANNEL,
  isParentToSandboxMessage,
  type SandboxRenderMessage,
} from "./sandbox-protocol";
import { applySandboxTheme } from "./sandbox-theme";
import { streamCompileDelay } from "./chat-sandbox-stream";

const FRIENDLY_RENDER_ERROR =
  "This answer could not be rendered as MDX, so it is shown as written.";

function installRuntimeCsp() {
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = [
    "default-src 'none'",
    "script-src 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  document.head.append(policy);
}

installRuntimeCsp();

function getParentOrigin(): string | null {
  if (document.referrer === "") return null;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}

const parentOrigin = getParentOrigin();
const sendToParent = (message: object) => {
  window.parent.postMessage(message, parentOrigin ?? "*");
};
const queryClientBridge = createSandboxQueryClient(sendToParent);
const reactQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

function getRootElement(): HTMLElement {
  const element = document.getElementById("sandbox-root");
  if (!element) throw new Error("Chat sandbox root element not found");
  return element;
}

const rootElement = getRootElement();

class MdxErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[chat sandbox] MDX render failed", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PlainText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap wrap-break-word">{text}</div>;
}

function SandboxMdx({ request }: { request: SandboxRenderMessage }) {
  const [content, setContent] = useState<{
    Content: MDXContent | null;
    error: unknown;
    source: string;
  }>({ Content: null, error: null, source: "" });
  const latestRequest = useRef(request);
  const attemptedSource = useRef("");
  const lastStartedAt = useRef(-Infinity);
  const compiling = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const startCompilation = useCallback((source: string) => {
    if (compiling.current || source.trim() === "") return;
    compiling.current = true;
    attemptedSource.current = source;
    lastStartedAt.current = performance.now();
    const normalizedSource = normalizeAssistantMdx(source);

    void compile(normalizedSource, {
      outputFormat: "function-body",
      remarkPlugins: [remarkSandboxPolicy],
    })
      .then((file) =>
        run(String(file), {
          ...runtime,
          baseUrl: window.location.href,
        }),
      )
      .then((module) => {
        if (!mounted.current) return;
        setContent({
          Content: module.default as MDXContent,
          error: null,
          source,
        });
      })
      .catch((error: unknown) => {
        const latest = latestRequest.current;
        if (
          mounted.current &&
          !latest.streaming &&
          source === latest.source
        ) {
          setContent({ Content: null, error, source });
        }
      })
      .finally(() => {
        compiling.current = false;
        const latest = latestRequest.current;
        if (!mounted.current || attemptedSource.current === latest.source) {
          return;
        }
        const delay = streamCompileDelay(
          latest.streaming,
          lastStartedAt.current,
          performance.now(),
        );
        timer.current = setTimeout(
          () => startCompilation(latest.source),
          delay,
        );
      });
  }, []);

  useEffect(() => {
    latestRequest.current = request;
    if (
      request.source.trim() === "" ||
      attemptedSource.current === request.source
    ) {
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    if (compiling.current) return;

    const delay = streamCompileDelay(
      request.streaming,
      lastStartedAt.current,
      performance.now(),
    );
    timer.current = setTimeout(
      () => startCompilation(request.source),
      delay,
    );
  }, [request, startCompilation]);

  const components = useMemo(
    () =>
      createMdxComponents(
        "project-bound-by-parent",
        queryClientBridge.runQuery,
      ),
    [],
  );

  if (content.Content === null && content.error === null) {
    return <PlainText text={request.source} />;
  }
  if (content.Content === null) {
    return (
      <div className="flex flex-col gap-1">
        <PlainText text={request.source} />
        <p className="text-muted-foreground text-[0.625rem]">
          {env.DEV && content.error instanceof Error
            ? `${FRIENDLY_RENDER_ERROR}\n\nDeveloper details: ${content.error.message}`
            : FRIENDLY_RENDER_ERROR}
        </p>
      </div>
    );
  }

  const Content = content.Content;
  return (
    <MdxErrorBoundary
      key={content.source}
      fallback={<PlainText text={request.source} />}
    >
      <div className="min-w-0">
        <Content components={components} />
      </div>
    </MdxErrorBoundary>
  );
}

function SandboxApp() {
  const [request, setRequest] = useState<SandboxRenderMessage | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (parentOrigin !== null && event.origin !== parentOrigin) return;
      if (!isParentToSandboxMessage(event.data)) return;

      if (event.data.type === "query-result") {
        queryClientBridge.receive(event.data);
        return;
      }

      applySandboxTheme(document.documentElement, event.data.theme);
      setRequest(event.data);
    };
    window.addEventListener("message", onMessage);
    sendToParent({ channel: CHAT_SANDBOX_CHANNEL, type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const reportHeight = () => {
      sendToParent({
        channel: CHAT_SANDBOX_CHANNEL,
        type: "height",
        height: Math.ceil(rootElement.scrollHeight),
      });
    };
    const observer = new ResizeObserver(reportHeight);
    observer.observe(rootElement);
    reportHeight();
    return () => observer.disconnect();
  }, []);

  return request ? <SandboxMdx request={request} /> : null;
}

const sandboxWindow = window as Window & {
  __versionlessChatSandboxRoot?: ReturnType<typeof ReactDOM.createRoot>;
};
const sandboxRoot =
  sandboxWindow.__versionlessChatSandboxRoot ??
  ReactDOM.createRoot(rootElement);
sandboxWindow.__versionlessChatSandboxRoot = sandboxRoot;
sandboxRoot.render(
  <QueryClientProvider client={reactQueryClient}>
    <SandboxApp />
  </QueryClientProvider>,
);
