import { spawn } from "node:child_process";

import { CliError } from "../errors";
import { bold, dim, green } from "../colors";
import {
  credentialKey,
  writeCredential,
} from "../auth/credentials";
import {
  getCurrentUser,
  initiateCliAuth,
  pollCliAuth,
  refreshAccessToken,
  resolveHexclaveSettings,
} from "../auth/hexclave";
import { GLOBAL_OPTIONS, parseFlags, str } from "./shared";

const HELP = `versionless login — authenticate the CLI via Hexclave

Usage: versionless login [options]

Opens the browser to confirm the login, then stores the resulting refresh
token in ~/.config/versionless/credentials.json (0600). Access tokens are
short-lived and never persisted.

Options:
  --project-id <id>   Hexclave project id (default: $HEXCLAVE_PROJECT_ID)
  --api-url <url>     Hexclave API base (default: $HEXCLAVE_API_URL or
                      https://api.hexclave.com)
  --app-url <url>     Origin serving the auth pages (default: $HEXCLAVE_APP_URL
                      or the project's built-with-hexclave.com hosted pages)
  --client-key <key>  Publishable client key, if the project requires one
                      (default: $HEXCLAVE_PUBLISHABLE_CLIENT_KEY)
  --no-open           Print the login URL instead of opening the browser
  --json              Machine-readable output
  -h, --help          Show this help
`;

export const AUTH_OPTIONS = {
  "project-id": { type: "string" },
  "api-url": { type: "string" },
  "app-url": { type: "string" },
  "client-key": { type: "string" },
} as const;

/** The browser-confirmation window Hexclave holds the login attempt open for. */
const LOGIN_EXPIRES_MILLIS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

function openBrowser(url: string): boolean {
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const child = spawn(cmd as string, args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runLogin(
  argv: string[],
  _cwd = process.cwd(),
  opts: { pollIntervalMs?: number } = {},
): Promise<number> {
  const { values } = parseFlags(argv, {
    ...GLOBAL_OPTIONS,
    ...AUTH_OPTIONS,
    "no-open": { type: "boolean", default: false },
  });
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  const json = values["json"] === true;
  // In --json mode progress goes to stderr so stdout stays parseable.
  const progress = (line: string): void => {
    (json ? process.stderr : process.stdout).write(`${line}\n`);
  };

  const settings = resolveHexclaveSettings({
    projectId: str(values["project-id"]),
    apiUrl: str(values["api-url"]),
    appUrl: str(values["app-url"]),
    clientKey: str(values["client-key"]),
  });

  const initiation = await initiateCliAuth(settings, LOGIN_EXPIRES_MILLIS);
  const opened = values["no-open"] !== true && openBrowser(initiation.loginUrl);
  progress(
    opened
      ? `Opened the browser to confirm the login. If nothing appeared, open:`
      : `Open this URL in the browser to log in:`,
  );
  progress(`  ${bold(initiation.loginUrl)}`);
  progress(dim("Waiting for confirmation…"));

  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + LOGIN_EXPIRES_MILLIS;
  let refreshToken: string;
  for (;;) {
    const poll = await pollCliAuth(settings, initiation.pollingCode);
    if (poll.status === "success") {
      refreshToken = poll.refreshToken;
      break;
    }
    if (poll.status === "expired" || poll.status === "used") {
      throw new CliError(
        poll.status === "expired"
          ? "Login attempt expired before it was confirmed — run `versionless login` again"
          : "This login attempt was already used — run `versionless login` again",
        5,
      );
    }
    if (Date.now() >= deadline) {
      throw new CliError("Timed out waiting for the browser confirmation", 5);
    }
    await sleep(pollIntervalMs);
  }

  // Round-trip the token before persisting so a bad login fails loudly here.
  const accessToken = await refreshAccessToken(settings, refreshToken);
  const user = await getCurrentUser(settings, accessToken);
  writeCredential(credentialKey(settings.apiUrl, settings.projectId), {
    refreshToken,
    userId: user.id,
    primaryEmail: user.primaryEmail,
    savedAt: new Date().toISOString(),
  });

  const who = user.primaryEmail ?? user.displayName ?? user.id;
  if (json) {
    console.log(
      JSON.stringify(
        {
          userId: user.id,
          primaryEmail: user.primaryEmail ?? null,
          displayName: user.displayName ?? null,
          projectId: settings.projectId,
          apiUrl: settings.apiUrl,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`${green("✓")} logged in as ${bold(who)} (project ${settings.projectId})`);
  }
  return 0;
}
