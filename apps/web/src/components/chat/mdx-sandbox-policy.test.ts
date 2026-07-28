import { compile } from "@mdx-js/mdx";
import { expect, test } from "bun:test";

import { remarkSandboxPolicy } from "./mdx-sandbox-policy";

function compileSandboxed(source: string) {
  return compile(source, {
    outputFormat: "function-body",
    remarkPlugins: [remarkSandboxPolicy],
  });
}

test("allows the live component contract with static data props", async () => {
  await expect(
    compileSandboxed(`
<Dashboard>
  <DashboardGrid>
    <QueryStat
      source="clickhouse"
      query="SELECT count() AS value FROM otel_logs WHERE Timestamp > now() - INTERVAL {days:UInt16} DAY"
      params={{ days: 7 }}
      label="Requests"
      format="number"
    />
  </DashboardGrid>
  <QueryTable
    source="postgres"
    select="version, created_at"
    from="project_versions"
    columns={[
      { key: "version", label: "Version", sortable: true },
      { key: "created_at", label: "Uploaded", format: "datetime" }
    ]}
    pageSize={25}
  />
</Dashboard>
`),
  ).resolves.toBeDefined();
});

test("rejects imports, executable expressions, handlers, and unsafe elements", async () => {
  const rejectedSources = [
    'import X from "https://example.com/x.js"\n\n<X />',
    "{globalThis.location.href}",
    '<Card onClick={() => fetch("https://example.com")} />',
    "<QueryStat params={{ days: globalThis.location.href }} query=\"SELECT 1\" label=\"x\" />",
    '<iframe src="https://example.com" />',
  ];

  for (const source of rejectedSources) {
    await expect(compileSandboxed(source)).rejects.toThrow();
  }
});
