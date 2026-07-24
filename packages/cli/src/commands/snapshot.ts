import { CliError } from "../errors";
import { serializeSurface } from "../surface/extract";
import { writeSnapshot } from "../snapshot/store";
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

  if (values["json"] === true) {
    console.log(JSON.stringify({ path, version, ...counts }, null, 2));
  } else {
    console.log(`${green("✓")} wrote ${bold(path)}`);
    console.log(
      `  version ${version} — ${counts.endpoints} endpoint(s), ${counts.models} model(s)`,
    );
  }
  return 0;
}
