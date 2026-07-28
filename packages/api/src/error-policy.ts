import { TRPCError, type TRPCDefaultErrorShape } from "@trpc/server";

import {
  ProjectQueryError,
  ProjectQueryUnavailableError,
} from "./lib/clickhouse-query";
import { isDevelopment as isDevelopmentEnv } from "./lib/env-mode";
import {
  ProjectPgQueryError,
  ProjectPgQueryUnavailableError,
} from "./lib/postgres-query";

const PUBLIC_ERROR_MESSAGES: Partial<
  Record<TRPCDefaultErrorShape["data"]["code"], string>
> = {
  BAD_REQUEST:
    "The request could not be completed. Check your input and try again.",
  CONFLICT: "That change could not be completed. Refresh and try again.",
  FORBIDDEN: "You do not have access to this resource.",
  NOT_FOUND: "The requested resource could not be found.",
  PRECONDITION_FAILED:
    "This service is temporarily unavailable. Please try again shortly.",
  TOO_MANY_REQUESTS: "Too many requests. Please wait and try again.",
  UNAUTHORIZED: "Please sign in to continue.",
};

const DEFAULT_PUBLIC_ERROR_MESSAGE =
  "Something went wrong. Please try again.";

export function publicErrorMessage(
  code: TRPCDefaultErrorShape["data"]["code"],
): string {
  return PUBLIC_ERROR_MESSAGES[code] ?? DEFAULT_PUBLIC_ERROR_MESSAGE;
}

/**
 * Keeps server diagnostics out of production tRPC payloads. Development
 * responses retain the original message and stack so the client can show
 * friendly copy alongside actionable local diagnostics.
 */
export function applyPublicErrorPolicy(
  shape: TRPCDefaultErrorShape,
  isDevelopment: boolean,
): TRPCDefaultErrorShape {
  if (isDevelopment) return shape;

  const { path: _path, stack: _stack, ...publicData } = shape.data;
  return {
    ...shape,
    message: publicErrorMessage(shape.data.code),
    data: publicData,
  };
}

export interface PublicHttpError {
  status: 400 | 403 | 404 | 503;
  message: string;
}

/**
 * Maps errors escaping a non-tRPC HTTP boundary (the raw query plane) onto
 * the same public-message policy as the tRPC error formatter. Production
 * clients get the policy copy; development keeps the actual diagnostic.
 * ProjectQueryError and ProjectPgQueryError messages pass through in both
 * modes because safeClickHouseError / safePostgresError already decided at
 * construction what a raw-query client may see.
 */
export function publicQueryHttpError(
  error: unknown,
  isDevelopment: boolean = isDevelopmentEnv,
): PublicHttpError {
  if (error instanceof TRPCError) {
    return {
      status: error.code === "NOT_FOUND" ? 404 : 403,
      message: isDevelopment
        ? error.message
        : publicErrorMessage(error.code),
    };
  }
  // The Unavailable subclasses must be tested before their bases: an
  // unavailable store is an operator problem (503), not a bad query (400).
  if (
    error instanceof ProjectQueryUnavailableError ||
    error instanceof ProjectPgQueryUnavailableError
  ) {
    return {
      status: 503,
      message: isDevelopment
        ? error.message
        : publicErrorMessage("PRECONDITION_FAILED"),
    };
  }
  if (
    error instanceof ProjectQueryError ||
    error instanceof ProjectPgQueryError
  ) {
    return { status: 400, message: error.message };
  }
  return {
    status: 503,
    message:
      isDevelopment && error instanceof Error
        ? error.message
        : publicErrorMessage("PRECONDITION_FAILED"),
  };
}
