export const MIN_SANDBOX_HEIGHT = 24;
export const MAX_SANDBOX_HEIGHT = 100_000;

export function normalizeSandboxHeight(height: number): number {
  return Math.min(
    MAX_SANDBOX_HEIGHT,
    Math.max(MIN_SANDBOX_HEIGHT, Math.ceil(height)),
  );
}
