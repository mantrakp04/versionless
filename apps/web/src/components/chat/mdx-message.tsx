import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/theme-provider";
import { clientErrorMessage } from "@/utils/client-error";
import {
  projectPgQuery,
  projectQuery,
  type QueryParameter,
} from "@/utils/project-query";
import {
  CHAT_SANDBOX_CHANNEL,
  isSandboxToParentMessage,
  type SandboxQueryRequest,
} from "./sandbox-protocol";
import {
  MIN_SANDBOX_HEIGHT,
  normalizeSandboxHeight,
} from "./sandbox-height";

const MAX_CONCURRENT_QUERIES = 8;
const SANDBOX_READY_TIMEOUT_MS = 5_000;

interface QueryDependencies {
  clickhouse: <TRow>(
    projectId: string,
    query: string,
    params?: Record<string, QueryParameter>,
  ) => Promise<TRow[]>;
  postgres: <TRow>(
    projectId: string,
    query: string,
    params?: QueryParameter[],
  ) => Promise<TRow[]>;
}

const queryDependencies: QueryDependencies = {
  clickhouse: projectQuery,
  postgres: projectPgQuery,
};

/**
 * Executes only against the project selected by the parent. The sandbox
 * protocol deliberately has no projectId field, so generated code cannot
 * redirect a query to a different project.
 */
export function executeSandboxQuery<TRow>(
  request: SandboxQueryRequest,
  projectId: string,
  dependencies: QueryDependencies = queryDependencies,
): Promise<TRow[]> {
  if (request.source === "postgres") {
    return dependencies.postgres<TRow>(
      projectId,
      request.query,
      Array.isArray(request.params) ? request.params : [],
    );
  }
  return dependencies.clickhouse<TRow>(
    projectId,
    request.query,
    Array.isArray(request.params) ? {} : request.params,
  );
}

function PlainText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap wrap-break-word">{text}</div>;
}

export function MdxMessage({
  text,
  projectId,
  streaming,
}: {
  text: string;
  projectId: string;
  streaming: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const latestRender = useRef({ text, streaming });
  const activeQueries = useRef(0);
  const ready = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [height, setHeight] = useState(MIN_SANDBOX_HEIGHT);
  const [failed, setFailed] = useState(false);
  const { resolvedTheme } = useTheme();
  const hostQueryClient = useQueryClient();

  const sendRender = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        channel: CHAT_SANDBOX_CHANNEL,
        type: "render",
        source: latestRender.current.text,
        streaming: latestRender.current.streaming,
        theme: resolvedTheme === "light" ? "light" : "dark",
      },
      "*",
    );
  }, [resolvedTheme]);

  useEffect(() => {
    latestRender.current = { text, streaming };
    sendRender();
  }, [sendRender, streaming, text]);

  useEffect(() => {
    ready.current = false;
    setFailed(false);
  }, [projectId]);

  useEffect(() => {
    let active = true;

    const onMessage = (event: MessageEvent) => {
      const sandboxWindow = iframeRef.current?.contentWindow;
      if (
        event.origin !== "null" ||
        !sandboxWindow ||
        event.source !== sandboxWindow ||
        !isSandboxToParentMessage(event.data)
      ) {
        return;
      }

      if (event.data.type === "ready") {
        ready.current = true;
        if (readyTimer.current) clearTimeout(readyTimer.current);
        sendRender();
        return;
      }
      if (event.data.type === "height") {
        setHeight(normalizeSandboxHeight(event.data.height));
        return;
      }

      const request = event.data;
      if (activeQueries.current >= MAX_CONCURRENT_QUERIES) {
        sandboxWindow.postMessage(
          {
            channel: CHAT_SANDBOX_CHANNEL,
            type: "query-result",
            requestId: request.requestId,
            error: "Too many dashboard queries are running.",
          },
          "*",
        );
        return;
      }

      activeQueries.current += 1;
      void hostQueryClient
        .fetchQuery({
          queryKey: [
            "chat-sandbox-query",
            projectId,
            request.source,
            request.query,
            request.params ?? null,
          ],
          queryFn: () =>
            executeSandboxQuery<Record<string, unknown>>(request, projectId),
          staleTime: 30_000,
        })
        .then((rows) => {
          if (!active || iframeRef.current?.contentWindow !== sandboxWindow) {
            return;
          }
          sandboxWindow.postMessage(
            {
              channel: CHAT_SANDBOX_CHANNEL,
              type: "query-result",
              requestId: request.requestId,
              rows,
            },
            "*",
          );
        })
        .catch((error: unknown) => {
          console.error("[chat] Sandboxed query failed", error);
          if (!active || iframeRef.current?.contentWindow !== sandboxWindow) {
            return;
          }
          sandboxWindow.postMessage(
            {
              channel: CHAT_SANDBOX_CHANNEL,
              type: "query-result",
              requestId: request.requestId,
              error: clientErrorMessage(
                error,
                "This query could not be run.",
              ),
            },
            "*",
          );
        })
        .finally(() => {
          activeQueries.current = Math.max(0, activeQueries.current - 1);
        });
    };

    window.addEventListener("message", onMessage);
    return () => {
      active = false;
      if (readyTimer.current) clearTimeout(readyTimer.current);
      window.removeEventListener("message", onMessage);
    };
  }, [hostQueryClient, projectId, sendRender]);

  const handleLoad = useCallback(() => {
    if (readyTimer.current) clearTimeout(readyTimer.current);
    if (!ready.current) {
      readyTimer.current = setTimeout(() => {
        if (!ready.current) setFailed(true);
      }, SANDBOX_READY_TIMEOUT_MS);
    }
    sendRender();
  }, [sendRender]);

  if (failed) {
    return (
      <div className="flex flex-col gap-1">
        <PlainText text={text} />
        <p className="text-muted-foreground text-[0.625rem]">
          This answer could not be opened in its secure renderer, so it is
          shown as written.
        </p>
      </div>
    );
  }

  return (
    <iframe
      className="block w-full border-0 bg-transparent"
      key={projectId}
      loading="lazy"
      onError={() => setFailed(true)}
      onLoad={handleLoad}
      ref={iframeRef}
      sandbox="allow-scripts"
      src="/chat-sandbox.html"
      style={{ height }}
      title="Assistant answer"
    />
  );
}
