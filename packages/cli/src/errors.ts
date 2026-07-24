/**
 * CLI exit codes:
 *   0 ok / warnings only
 *   1 uncovered breaking change
 *   2 config / usage error
 *   3 extraction failed
 *   4 snapshot format mismatch
 *   5 authentication failed
 *   6 analytics query failed
 */
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = 2,
  ) {
    super(message);
    this.name = "CliError";
  }
}
