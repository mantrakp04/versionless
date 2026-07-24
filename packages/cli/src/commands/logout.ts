import { green, yellow } from "../colors";
import { credentialKey, deleteCredential } from "../auth/credentials";
import { resolveHexclaveSettings } from "../auth/hexclave";
import { AUTH_OPTIONS } from "./login";
import { GLOBAL_OPTIONS, parseFlags, str } from "./shared";

const HELP = `versionless logout — forget the stored Hexclave login

Usage: versionless logout [options]

Removes the refresh token stored by \`versionless login\` for the resolved
project. Logging out is local; it does not revoke other sessions.

Options:
  --project-id <id>   Hexclave project id (default: $HEXCLAVE_PROJECT_ID)
  --api-url <url>     Hexclave API base (default: $HEXCLAVE_API_URL or
                      https://api.hexclave.com)
  --json              Machine-readable output
  -h, --help          Show this help
`;

export async function runLogout(
  argv: string[],
  _cwd = process.cwd(),
): Promise<number> {
  const { values } = parseFlags(argv, { ...GLOBAL_OPTIONS, ...AUTH_OPTIONS });
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }

  const settings = resolveHexclaveSettings({
    projectId: str(values["project-id"]),
    apiUrl: str(values["api-url"]),
    appUrl: str(values["app-url"]),
    clientKey: str(values["client-key"]),
  });
  const removed = deleteCredential(
    credentialKey(settings.apiUrl, settings.projectId),
  );

  if (values["json"] === true) {
    console.log(
      JSON.stringify({ projectId: settings.projectId, removed }, null, 2),
    );
  } else if (removed) {
    console.log(`${green("✓")} logged out of project ${settings.projectId}`);
  } else {
    console.log(
      `${yellow("!")} no stored login for project ${settings.projectId}`,
    );
  }
  return 0;
}
