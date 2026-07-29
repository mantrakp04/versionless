import { evaluate } from "@mdx-js/mdx";
import { expect, test } from "bun:test";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

import { remarkSandboxPolicy } from "./mdx-sandbox-policy";
import { normalizeAssistantMdx } from "./normalize-assistant-mdx";
import { createMdxComponents } from "./registry";
import type { QueryRunner } from "./query-runner";

const runtime = { Fragment, jsx, jsxs } as const;
const unusedQueryRunner: QueryRunner = async () => [];

/** Compiles and renders MDX the way the message component does at runtime. */
async function render(source: string): Promise<string> {
  const module = await evaluate(normalizeAssistantMdx(source), {
    ...runtime,
    baseUrl: "https://dashboard.versionless.test/",
    remarkPlugins: [remarkSandboxPolicy],
  });
  const Content = module.default;
  return renderToStaticMarkup(
    jsx(Content, {
      components: createMdxComponents("p_1", unusedQueryRunner),
    }),
  );
}

test("renders markdown prose through the registry's element overrides", async () => {
  const html = await render("## Adoption\n\nMost traffic is on `2026-07-24`.\n");

  // h2 is demoted to h3: chat bubbles are narrow, so the dashboard's heading
  // scale would dominate the answer.
  expect(html).toContain("<h3");
  expect(html).toContain("Adoption");
  expect(html).toContain("<code");
  expect(html).toContain("2026-07-24");
});

test("renders a presentational component the prompt advertises", async () => {
  const html = await render(
    '<Card>\n  <CardHeader>\n    <CardTitle>Blockers</CardTitle>\n  </CardHeader>\n  <CardContent>Two consumers are pinned.</CardContent>\n</Card>\n',
  );

  expect(html).toContain("Blockers");
  expect(html).toContain("Two consumers are pinned.");
  expect(html).toContain('data-slot="card"');
});

test("renders the live dashboard composition the prompt advertises", async () => {
  const html = await render(
    "<Dashboard>\n  <DashboardGrid>\n    <Card>Live query widgets go here.</Card>\n  </DashboardGrid>\n</Dashboard>",
  );

  expect(html).toContain('data-slot="assistant-dashboard"');
  expect(html).toContain('data-slot="assistant-dashboard-grid"');
  expect(html).toContain("Live query widgets go here.");
});

test("renders a fenced React dashboard wrapper without executing its module code", async () => {
  const html = await render(`\`\`\`jsx
import React from "react";
import { Card } from "@/components/ui/card";

const Dashboard = () => {
  return (
    <div className="grid gap-4">
      <h1>Dashboard</h1>
      <Card>Rendered card</Card>
    </div>
  );
};

export default Dashboard;
\`\`\``);

  expect(html).toContain("<h1");
  expect(html).toContain("Rendered card");
  expect(html).not.toContain("import React");
});

test("still rejects executable expressions inside an unwrapped dashboard", async () => {
  expect(
    render(`\`\`\`jsx
const Dashboard = () => {
  return (
    <Dashboard>{window.parent.document.cookie}</Dashboard>
  );
};
\`\`\``),
  ).rejects.toThrow(/JavaScript expressions are not allowed/);
});

test("opens external links in a new tab without leaking the referrer", async () => {
  const html = await render("[docs](https://versionless.com/docs)\n");

  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noreferrer"');
});

test("a component the model invented fails rather than rendering", async () => {
  // The message wraps rendering in an error boundary, so this surfaces as the
  // fallback copy instead of a blank dialog.
  expect(render("<QueryDashboard />\n")).rejects.toThrow(
    /Element `QueryDashboard` is not allowed/,
  );
});

test("a half-written component fails so streaming can retain its last valid snapshot", async () => {
  expect(render('<QueryTable source="clickhouse" select="cou')).rejects.toThrow();
});
