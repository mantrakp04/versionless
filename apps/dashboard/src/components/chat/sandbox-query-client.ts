import type { QueryRunner } from "./query-runner";
import {
  CHAT_SANDBOX_CHANNEL,
  type SandboxQueryResult,
} from "./sandbox-protocol";

const QUERY_TIMEOUT_MS = 15_000;

interface PendingQuery {
  resolve: (rows: Record<string, unknown>[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export function createSandboxQueryClient(
  send: (message: object) => void,
): {
  runQuery: QueryRunner;
  receive: (message: SandboxQueryResult) => void;
  dispose: () => void;
} {
  const pending = new Map<string, PendingQuery>();

  const runQuery: QueryRunner = <TRow>(input: Parameters<QueryRunner>[0]) => {
    const requestId = crypto.randomUUID();
    return new Promise<TRow[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("The sandbox query timed out"));
      }, QUERY_TIMEOUT_MS);
      pending.set(requestId, {
        resolve: resolve as (rows: Record<string, unknown>[]) => void,
        reject,
        timeout,
      });
      send({
        channel: CHAT_SANDBOX_CHANNEL,
        type: "query",
        requestId,
        ...input,
      });
    });
  };

  return {
    runQuery,
    receive(message) {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      clearTimeout(request.timeout);
      if (message.error !== undefined) {
        request.reject(new Error(message.error));
      } else {
        request.resolve(message.rows ?? []);
      }
    },
    dispose() {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error("The sandbox query client was disposed"));
      }
      pending.clear();
    },
  };
}
