import { isDevelopment as isDevelopmentEnv } from "./env-mode";

const SAFE_CLICKHOUSE_ERROR_CODES = new Set([
  62, // SYNTAX_ERROR
  158, // TOO_MANY_ROWS
  159, // TIMEOUT_EXCEEDED
  164, // READONLY
  396, // TOO_MANY_ROWS_OR_BYTES
  636, // CANNOT_EXTRACT_TABLE_STRUCTURE
]);

const DEFAULT_QUERY_ERROR = "Error during execution of this query.";

type ClickHouseError = {
  code: string;
  message: string;
};

function isClickHouseError(error: unknown): error is ClickHouseError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    Number.isFinite(Number(error.code)) &&
    "message" in error &&
    typeof error.message === "string"
  );
}

/**
 * ClickHouse can resolve restricted columns before checking privileges, so
 * identifier/type/access errors may disclose private schema information.
 * Only operational errors known not to contain tenant data are public.
 */
export function safeClickHouseError(
  error: unknown,
  isDevelopment = isDevelopmentEnv,
): string {
  if (!isClickHouseError(error)) return DEFAULT_QUERY_ERROR;
  const code = Number(error.code);
  if (SAFE_CLICKHOUSE_ERROR_CODES.has(code)) return error.message;
  return isDevelopment
    ? `${DEFAULT_QUERY_ERROR}\n\nClickHouse ${code}: ${error.message}`
    : DEFAULT_QUERY_ERROR;
}

