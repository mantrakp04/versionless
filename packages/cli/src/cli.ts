import { red } from "./colors";
import { CliError } from "./errors";
import { runChangelog } from "./commands/changelog";
import { runCheck } from "./commands/check";
import { runExplain } from "./commands/explain";
import { runGenerate } from "./commands/generate";
import { runInit } from "./commands/init";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import { runQuery } from "./commands/query";
import { runSnapshot } from "./commands/snapshot";
import { runVerify } from "./commands/verify";
import { runWatch } from "./commands/watch";
import { runWhoami } from "./commands/whoami";

const USAGE = `versionless — API surface snapshots, diffing, and change coverage

Usage: versionless <command> [options]

Commands:
  init       Scaffold versionless.config.ts, the surface entry, and agent docs
  snapshot   Extract the API surface and write .versionless/<version>.json
  check      Diff head vs the last snapshot; fail on uncovered breaking changes
  verify     Run each change's wire-shape fixtures + tolerant-reader probes
  watch      Re-run check whenever the surface, changes, or snapshots change
  generate   Scaffold a change file covering the uncovered diffs
  explain    Show the transform path an old client walks for a route
  changelog  Render the change chain as markdown
  login      Authenticate the CLI via Hexclave (browser confirmation flow)
  logout     Forget the stored Hexclave login
  whoami     Show and verify the logged-in Hexclave user
  query      Run project-scoped read-only ClickHouse SQL

Global options (accepted by every command):
  --config <path>  Path to versionless.config.ts (default: walk up from cwd)
  --json           Machine-readable output
  -h, --help       Per-command help

Exit codes: 0 ok/warnings · 1 uncovered breaking change · 2 config/usage error ·
3 extraction failed · 4 snapshot format mismatch · 5 authentication failed ·
6 analytics query failed
`;

export async function main(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }

  try {
    switch (command) {
      case "init":
        return await runInit(rest, cwd);
      case "snapshot":
        return await runSnapshot(rest, cwd);
      case "check":
        return await runCheck(rest, cwd);
      case "verify":
        return await runVerify(rest, cwd);
      case "watch":
        return await runWatch(rest, cwd);
      case "generate":
        return await runGenerate(rest, cwd);
      case "explain":
        return await runExplain(rest, cwd);
      case "changelog":
        return await runChangelog(rest, cwd);
      case "login":
        return await runLogin(rest, cwd);
      case "logout":
        return await runLogout(rest, cwd);
      case "whoami":
        return await runWhoami(rest, cwd);
      case "query":
        return await runQuery(rest, cwd);
      default:
        process.stderr.write(`Unknown command "${command}"\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${red("error:")} ${err.message}\n`);
      return err.exitCode;
    }
    process.stderr.write(
      `${red("error:")} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    return 2;
  }
}
