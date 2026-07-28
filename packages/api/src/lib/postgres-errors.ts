import { isDevelopment as isDevelopmentEnv } from "./env-mode";

/**
 * SQLSTATEs whose message describes the *request* rather than the schema
 * behind it. Everything else — undefined_table, undefined_column,
 * insufficient_privilege — names objects the caller was not granted and would
 * turn a failed query into schema reconnaissance, so it collapses to the
 * generic string.
 */
const SAFE_POSTGRES_ERROR_CODES = new Set([
  "42601", // syntax_error
  "57014", // query_canceled (statement_timeout)
  "53400", // configuration_limit_exceeded
  "54000", // program_limit_exceeded
  "54001", // statement_too_complex
  "25006", // read_only_sql_transaction
]);

const DEFAULT_QUERY_ERROR = "Error during execution of this query.";

type PostgresError = {
  code: string;
  message: string;
};

function isPostgresError(error: unknown): error is PostgresError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0 &&
    "message" in error &&
    typeof error.message === "string"
  );
}

/**
 * Postgres error text routinely embeds table names, column names, constraint
 * names and offending values. Only the allowlisted operational codes are
 * public; development additionally carries the raw diagnostic so a local
 * failure stays actionable.
 */
export function safePostgresError(
  error: unknown,
  isDevelopment = isDevelopmentEnv,
): string {
  if (!isPostgresError(error)) return DEFAULT_QUERY_ERROR;
  if (SAFE_POSTGRES_ERROR_CODES.has(error.code)) return error.message;
  return isDevelopment
    ? `${DEFAULT_QUERY_ERROR}\n\nPostgres ${error.code}: ${error.message}`
    : DEFAULT_QUERY_ERROR;
}
