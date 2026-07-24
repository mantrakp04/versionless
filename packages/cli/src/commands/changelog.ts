import { writeFileSync } from "node:fs";

import { loadChangeChain, changeVersion, type ChangeLike } from "../chain";
import { green, bold } from "../colors";
import { renderField } from "../diff/render";
import {
  listSnapshotVersions,
  readSnapshot,
  snapshotPath,
} from "../snapshot/store";
import type { Field, Surface, TypeNode } from "../surface/types";
import { GLOBAL_OPTIONS, loadProject, parseFlags, str } from "./shared";

const HELP = `versionless changelog — render the registered change chain as a
markdown changelog, newest version first.

Usage: versionless changelog [options]

Options:
  --out <file>     Write to a file instead of stdout
  --config <path>  Path to versionless.config.ts
  -h, --help       Show this help

When snapshots exist on both sides of a change, field bullets are enriched
with the before/after types.
`;

/** Best-effort lookup of a field by diff-style path ("a.b", "items[].price"). */
function lookupField(model: TypeNode | undefined, path: string): Field | null {
  if (model === undefined) return null;
  let node: TypeNode = model;
  const segments = path.split(".");
  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];
    if (segment === undefined) return null;
    // Strip array/tuple/record hops from the segment tail.
    const hops: string[] = [];
    const hopMatch = /(\[[^\]]*\])+$/.exec(segment);
    if (hopMatch) {
      for (const hop of hopMatch[0].matchAll(/\[[^\]]*\]/g)) hops.push(hop[0]);
      segment = segment.slice(0, segment.length - hopMatch[0].length);
    }
    if (node.kind !== "object") return null;
    const field: Field | undefined = node.fields[segment];
    if (field === undefined) return null;
    if (i === segments.length - 1 && hops.length === 0) return field;
    node = field.type;
    for (const _hop of hops) {
      if (node.kind === "array") node = node.items;
      else if (node.kind === "record") node = node.value;
      else return null;
    }
    if (i === segments.length - 1) return { type: node };
  }
  return null;
}

interface SnapshotPair {
  before: Surface | null;
  after: Surface | null;
}

function snapshotsAround(
  dir: string,
  versions: string[],
  changeV: string,
): SnapshotPair {
  let before: string | null = null;
  let after: string | null = null;
  for (const v of versions) {
    if (v < changeV) before = v;
    if (v >= changeV && after === null) after = v;
  }
  const load = (v: string | null): Surface | null => {
    if (v === null) return null;
    try {
      return readSnapshot(snapshotPath(dir, v));
    } catch {
      return null;
    }
  };
  return { before: load(before), after: load(after) };
}

function typeOf(surface: Surface | null, model: string, path: string): string | null {
  if (!surface) return null;
  const field = lookupField(surface.models[model], path);
  return field ? renderField(field) : null;
}

export function renderChangelog(
  chain: ChangeLike[],
  snapshotDir: string,
): string {
  const versions = [...new Set(chain.map(changeVersion))].sort().reverse();
  const snapshotVersions = listSnapshotVersions(snapshotDir);
  const lines: string[] = ["# API Changelog", ""];

  for (const version of versions) {
    lines.push(`## ${version}`, "");
    const group = chain.filter((c) => changeVersion(c) === version);
    for (const change of group) {
      const breaking = change.declarations.length > 0;
      const jumpNote =
        change.kind === "jump" ? ` (jump from ${change.from})` : "";
      lines.push(
        `### ${change.describe}${jumpNote}${breaking ? " **[BREAKING]**" : ""}`,
        "",
      );

      const { before, after } = snapshotsAround(
        snapshotDir,
        snapshotVersions,
        version,
      );
      for (const decl of change.declarations) {
        for (const field of decl.removed ?? []) {
          const was = typeOf(before, decl.model, field);
          lines.push(
            `- **${decl.model}**: removed \`${field}\`${was ? ` (was \`${was}\`)` : ""}`,
          );
        }
        for (const field of decl.added ?? []) {
          const now = typeOf(after, decl.model, field);
          lines.push(
            `- **${decl.model}**: added \`${field}\`${now ? ` (\`${now}\`)` : ""}`,
          );
        }
        for (const [from, to] of Object.entries(decl.renamed ?? {})) {
          lines.push(`- **${decl.model}**: renamed \`${from}\` → \`${to}\``);
        }
        for (const field of decl.typeChanged ?? []) {
          const was = typeOf(before, decl.model, field);
          const now = typeOf(after, decl.model, field);
          lines.push(
            `- **${decl.model}**: changed \`${field}\`${was && now ? ` (\`${was}\` → \`${now}\`)` : ""}`,
          );
        }
        for (const route of decl.routesRemoved ?? []) {
          lines.push(`- removed route \`${route}\``);
        }
      }
      if (change.routes.length > 0) {
        lines.push(
          `- affected routes: ${change.routes.map((r) => `\`${r}\``).join(", ")}`,
        );
      }
      if (change.lossy) {
        lines.push(
          `- ⚠ lossy: serving old clients on this route loses data in down-conversion`,
        );
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function runChangelog(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const { values } = parseFlags(argv, {
    ...GLOBAL_OPTIONS,
    out: { type: "string" },
  });
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }

  const project = await loadProject(cwd, str(values["config"]));
  const chain = await loadChangeChain(project.config, project.entry);
  const markdown = renderChangelog(chain, project.config.snapshotDir);

  const out = str(values["out"]);
  if (out !== undefined) {
    writeFileSync(out, markdown);
    console.log(`${green("✓")} wrote ${bold(out)}`);
  } else {
    process.stdout.write(markdown);
  }
  return 0;
}
