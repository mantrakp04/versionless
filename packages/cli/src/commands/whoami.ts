import { bold } from "../colors";
import {
  getAccessToken,
  getCurrentUser,
  resolveHexclaveSettings,
} from "../auth/hexclave";
import { AUTH_OPTIONS } from "./login";
import { GLOBAL_OPTIONS, parseFlags, str } from "./shared";

const HELP = `versionless whoami — show the logged-in Hexclave user

Usage: versionless whoami [options]

Exchanges the stored refresh token for an access token and fetches the
current user, so it also verifies the stored login is still valid.

Options:
  --project-id <id>   Hexclave project id (default: $HEXCLAVE_PROJECT_ID)
  --api-url <url>     Hexclave API base (default: $HEXCLAVE_API_URL or
                      https://api.hexclave.com)
  --client-key <key>  Publishable client key, if the project requires one
  --json              Machine-readable output
  -h, --help          Show this help
`;

export async function runWhoami(
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
  const accessToken = await getAccessToken(settings);
  const user = await getCurrentUser(settings, accessToken);

  if (values["json"] === true) {
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
    const who = user.primaryEmail ?? user.displayName ?? user.id;
    console.log(`${bold(who)} (user ${user.id}, project ${settings.projectId})`);
  }
  return 0;
}
