import { CliError } from "../errors";
import { serializeSurface } from "../surface/extract";
import { writeSnapshot } from "../snapshot/store";
import { resolveSnapshotApiUrl, uploadSnapshot } from "../snapshot/upload";
import { bold, green } from "../colors";
import {
  countEndpoints,
  extract,
  GLOBAL_OPTIONS,
  loadProject,
  parseFlags,
  resolveVersion,
  str,
} from "./shared";

const HELP = `versionless snapshot — extract the API surface and store it

Usage: versionless snapshot [options]

Options:
  --version <v>       Version to stamp on the snapshot (default: the instance's
                      \`current\` when the entry exports it, else today UTC)
  --check-idempotent  Extract twice and fail (exit 3) if the bytes differ
  --overwrite         Replace an existing snapshot whose content differs
                      (refused by default — snapshots are published contracts)
  --config <path>     Path to versionless.config.ts
  --json              Machine-readable output
  -h, --help          Show this help

The written snapshot carries an integrity hash (verified on every read) and,
in GitHub Actions, provenance metadata (repo/ref/sha of the producing commit).
When the exported SDK instance has an \`apiKey\` (or VERSIONLESS_API_KEY is set),
the same generated file is uploaded to the instance's configured \`project\`.
Its \`apiUrl\` can override the target.
`;

export async function runSnapshot(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const { values } = parseFlags(argv, {
    ...GLOBAL_OPTIONS,
    version: { type: "string" },
    "check-idempotent": { type: "boolean", default: false },
    overwrite: { type: "boolean", default: false },
  });
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }

  const project = await loadProject(cwd, str(values["config"]));
  const version = resolveVersion(project.entry, str(values["version"]));
  const surface = extract(project, version);

  if (values["check-idempotent"] === true) {
    const again = extract(project, version);
    if (serializeSurface(surface) !== serializeSurface(again)) {
      throw new CliError(
        "Extraction is not idempotent: two extractions of the same surface produced different bytes",
        3,
      );
    }
  }

  const path = writeSnapshot(project.config.snapshotDir, surface, {
    overwrite: values["overwrite"] === true,
  });
  const counts = countEndpoints(surface);
  const cloud = project.entry.instance?._cloud;
  // The exported instance is the single source of cloud identity. VERSIONLESS_API_KEY
  // stays the default key source for entries that do not wire `apiKey` themselves;
  // the CLI is a published package, so a raw env read is correct here.
  const apiKey =
    cloud?.apiKey?.trim() || process.env["VERSIONLESS_API_KEY"]?.trim();
  const projectName = cloud?.project?.trim();
  let upload:
    | { projectId: string; version: string; created: boolean }
    | undefined;
  if (apiKey) {
    if (!projectName) {
      throw new CliError(
        "Cannot upload the snapshot: no cloud `project` name is configured. " +
          "Set it on the exported Versionless instance — " +
          "`createVersionless({ project: \"my-api\", apiKey: process.env.VERSIONLESS_API_KEY, ... })` " +
          `— in ${project.config.entry}, exported as \`${project.config.instanceExport}\`.`,
        2,
      );
    }
    upload = await uploadSnapshot({
      apiKey,
      project: projectName,
      path,
      serverUrl: resolveSnapshotApiUrl({ apiUrl: cloud?.apiUrl }),
    });
  }

  if (values["json"] === true) {
    console.log(
      JSON.stringify(
        { path, version, ...counts, uploaded: upload !== undefined, upload },
        null,
        2,
      ),
    );
  } else {
    console.log(`${green("✓")} wrote ${bold(path)}`);
    console.log(
      `  version ${version} — ${counts.endpoints} endpoint(s), ${counts.models} model(s)`,
    );
    if (upload) {
      console.log(
        `${green("✓")} ${upload.created ? "uploaded" : "confirmed"} ${bold(
          projectName!,
        )} version ${upload.version}`,
      );
    }
  }
  return 0;
}
