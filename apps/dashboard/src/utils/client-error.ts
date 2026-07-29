import { env } from "@versionless/env/vite";

const DEFAULT_FRIENDLY_ERROR = "Something went wrong. Please try again.";

function errorDetails(error: unknown): string | null {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return null;
}

/**
 * Production UI receives only user-safe copy. Development UI includes the
 * same friendly copy plus the original diagnostic message.
 */
export function clientErrorMessage(
  error: unknown,
  friendlyMessage = DEFAULT_FRIENDLY_ERROR,
  isDevelopment = env.DEV,
): string {
  if (!isDevelopment) return friendlyMessage;

  const details = errorDetails(error);
  if (!details || details === friendlyMessage) return friendlyMessage;
  return `${friendlyMessage}\n\nDeveloper details: ${details}`;
}
