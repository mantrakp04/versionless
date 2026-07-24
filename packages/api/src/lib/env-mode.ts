import { env } from "@versionless/env/server";

/**
 * The single "is this development?" predicate for error disclosure. Only a
 * schemed NODE_ENV of exactly "development" opts into diagnostics — test and
 * production both get the scrubbed public copy, per the client error safety
 * rule. Every callsite that decides what an error response may reveal must
 * use this instead of reading NODE_ENV itself.
 */
export const isDevelopment = env.NODE_ENV === "development";
