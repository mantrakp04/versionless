/** A tool call as the UI needs it, flattened out of the AI SDK's part union. */
export interface WorkStep {
  /** `clickhouse_query`, `postgres_query`, … */
  toolName: string;
  state: "running" | "done" | "failed";
  /** The SQL the model wrote, when it has finished streaming the input. */
  sql?: string;
  /** Rows returned, or the public error message when the call failed. */
  detail?: string;
}

/**
 * Parts arrive as `tool-<name>` with a `state` that walks
 * input-streaming → input-available → output-available | output-error. Only
 * the last two are terminal.
 */
export function toWorkStep(part: {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}): WorkStep | null {
  if (!part.type.startsWith("tool-")) return null;
  const toolName = part.type.slice("tool-".length);
  const input = part.input as { sql?: unknown } | undefined;
  const sql = typeof input?.sql === "string" ? input.sql : undefined;

  if (part.state === "output-error") {
    return { toolName, state: "failed", sql, detail: part.errorText };
  }
  if (part.state === "output-available") {
    const output = part.output as
      | { ok?: boolean; rows?: unknown[]; truncated?: boolean; error?: string }
      | undefined;
    // A tool that returns `ok: false` did not throw — the route hands the
    // model a readable message so it can fix its SQL — but it is still a
    // failed step as far as the timeline is concerned.
    if (output?.ok === false) {
      return { toolName, state: "failed", sql, detail: output.error };
    }
    const count = output?.rows?.length ?? 0;
    return {
      toolName,
      state: "done",
      sql,
      detail: `${count} row${count === 1 ? "" : "s"}${output?.truncated ? " (capped)" : ""}`,
    };
  }
  return { toolName, state: "running", sql };
}

/** "1.4s", "12s", "2m 05s" — short enough to sit in a collapsed trigger. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(ms, 0)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}

/**
 * The collapsed line the work block becomes once streaming ends, e.g.
 * "Worked for 12s · 4 queries". Duration is omitted when it was not measured
 * (a conversation restored without timing) rather than shown as "0ms".
 */
export function workSummary(
  steps: readonly WorkStep[],
  durationMs: number | null,
): string {
  const parts: string[] = [];
  parts.push(
    durationMs === null ? "Worked" : `Worked for ${formatDuration(durationMs)}`,
  );
  if (steps.length > 0) {
    parts.push(`${steps.length} quer${steps.length === 1 ? "y" : "ies"}`);
  }
  const failed = steps.filter((step) => step.state === "failed").length;
  if (failed > 0) parts.push(`${failed} retried`);
  return parts.join(" · ");
}
