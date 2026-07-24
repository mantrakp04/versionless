import {
  compilePipeline,
  normalizeRouteKey,
  walkPath,
  type ChangeRegistry,
} from "@versionless/core";
import type { Change, Jump, SunsetEntry } from "@versionless/core";

import { bold, dim, green, red, yellow } from "../colors";
import { CliError } from "../errors";
import { GLOBAL_OPTIONS, loadProject, parseFlags, str } from "./shared";

const HELP = `versionless explain — show what a client on an old version gets
for a route: effective version, transform path, sunset status.

Usage: versionless explain <route> [options]

  <route>  "GET /users/:id", "trpc:user.get", or a bare procedure "user.get"

Options:
  --version <v>    Requested client version (default: the oldest release)
  --config <path>  Path to versionless.config.ts
  --json           Machine-readable output
  -h, --help       Show this help

Requires the entry to export the core instance (default export name
"versionless"; override with \`instance\` in versionless.config.ts).
`;

interface StepInfo {
  kind: "change" | "jump";
  label: string;
  describe: string;
  transforms: string[];
  lossy: boolean;
}

function stepInfo(step: Change | Jump): StepInfo {
  const transforms: string[] = [];
  if (step.hasUp) transforms.push("request.up");
  if (step.hasDown) transforms.push("response.down");
  if (step.spec.error?.down) transforms.push("error.down");
  if (step.kind === "change" && step.spec.rewrite) transforms.push("rewrite");
  return {
    kind: step.kind,
    label: step.kind === "change" ? step.version : `${step.from} -> ${step.to}`,
    describe: step.describe,
    transforms,
    lossy: step.lossy,
  };
}

function sunsetStatus(
  registry: ChangeRegistry,
  version: string,
): { after: string; message?: string; gone: boolean } | null {
  // A sunset on X applies to every version <= X; the earliest cutoff wins.
  let winner: SunsetEntry | null = null;
  for (const entry of registry.sunsets) {
    if (registry.scheme.compare(version, entry.version) > 0) continue;
    if (!winner || entry.after < winner.after) winner = entry;
  }
  if (!winner) return null;
  const [y, m, d] = winner.after.split("-").map(Number) as [number, number, number];
  const cutoff = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return {
    after: winner.after,
    ...(winner.message !== undefined ? { message: winner.message } : {}),
    gone: Date.now() > cutoff,
  };
}

export async function runExplain(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  const { values, positionals } = parseFlags(
    argv,
    { ...GLOBAL_OPTIONS, version: { type: "string" } },
    true,
  );
  if (values["help"] === true) {
    process.stdout.write(HELP);
    return 0;
  }
  const routeArg = positionals[0];
  if (routeArg === undefined) {
    throw new CliError("explain needs a route argument (see --help)", 2);
  }

  const project = await loadProject(cwd, str(values["config"]));
  const instance = project.entry.instance;
  if (!instance) {
    throw new CliError(
      `explain needs the entry to export the core instance ` +
        `(export "${project.config.instanceExport}" from ${project.config.entry})`,
      2,
    );
  }
  const registry = instance._registry as ChangeRegistry;
  registry.seal(); // builds releaseVersions; idempotent

  const routeKey = routeArg.includes(" ")
    ? normalizeRouteKey(routeArg)
    : routeArg.startsWith("trpc:")
      ? routeArg
      : `trpc:${routeArg}`;

  const requested =
    str(values["version"]) ?? registry.releaseVersions[0] ?? instance.current;
  const effective = registry.effectiveVersion(requested);

  const matched = registry.routeChanges(routeKey) !== undefined;
  const steps = matched ? walkPath(registry, routeKey, effective) : [];
  const pipeline =
    steps.length > 0 ? compilePipeline(registry, routeKey, effective) : null;
  const infos = steps.map(stepInfo);
  const sunset = sunsetStatus(registry, effective);

  if (values["json"] === true) {
    console.log(
      JSON.stringify(
        {
          route: routeArg,
          routeKey,
          matched,
          requestedVersion: requested,
          effectiveVersion: effective,
          current: instance.current,
          steps: infos,
          transformCount: pipeline?.transformCount ?? 0,
          passthrough: pipeline?.passthroughStream ?? false,
          lossy: infos.some((i) => i.lossy),
          sunset,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(bold(routeKey));
  console.log(`  requested version: ${requested}`);
  console.log(
    `  effective version: ${effective}${effective === instance.current ? dim(" (current)") : ""}`,
  );
  console.log(
    `  matched routeKey:  ${matched ? routeKey : dim("no changes touch this route (identity)")}`,
  );
  if (infos.length > 0) {
    console.log(`  path (${infos.length} step(s), oldest first):`);
    infos.forEach((info, i) => {
      const lossy = info.lossy ? ` ${yellow("[lossy]")}` : "";
      console.log(`    ${i + 1}. ${info.kind} ${bold(info.label)} — ${info.describe}${lossy}`);
      console.log(
        `       transforms: ${info.transforms.length > 0 ? info.transforms.join(", ") : dim("none (declaration-only)")}`,
      );
    });
    console.log(`  transformCount: ${pipeline?.transformCount ?? 0}`);
    console.log(
      `  passthrough: ${pipeline?.passthroughStream ? yellow("yes (stream)") : "no"}`,
    );
    console.log(
      `  lossy: ${infos.some((i) => i.lossy) ? yellow("yes") : "no"}`,
    );
  }
  if (sunset) {
    console.log(
      `  sunset: after ${sunset.after} ${sunset.gone ? red("(GONE — serving 410)") : green("(still served, headers advertised)")}${sunset.message ? dim(` — ${sunset.message}`) : ""}`,
    );
  } else {
    console.log(`  sunset: ${dim("none")}`);
  }
  return 0;
}
