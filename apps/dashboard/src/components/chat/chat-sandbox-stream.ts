export const STREAM_COMPILE_INTERVAL_MS = 40;

export function streamCompileDelay(
  streaming: boolean,
  lastStartedAt: number,
  now: number,
) {
  return streaming
    ? Math.max(0, STREAM_COMPILE_INTERVAL_MS - (now - lastStartedAt))
    : 0;
}
