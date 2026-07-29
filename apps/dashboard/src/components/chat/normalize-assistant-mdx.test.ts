import { expect, test } from "bun:test";

import { normalizeAssistantMdx } from "./normalize-assistant-mdx";

test("unwraps a fenced React dashboard to its declarative component tree", () => {
  const source = `\`\`\`jsx
import React from "react";
import { Card } from "@/components/ui/card";

const AdoptionDashboard = () => {
  return (
    <Dashboard>
      <Card>Live adoption</Card>
    </Dashboard>
  );
};

export default AdoptionDashboard;
\`\`\``;

  expect(normalizeAssistantMdx(source)).toBe(`<Dashboard>
      <Card>Live adoption</Card>
    </Dashboard>`);
});

test("unwraps a direct fenced MDX tree", () => {
  expect(
    normalizeAssistantMdx(`\`\`\`mdx
<Dashboard>
  <QueryStat label="Requests" />
</Dashboard>
\`\`\``),
  ).toBe(`<Dashboard>
  <QueryStat label="Requests" />
</Dashboard>`);
});

test("leaves ordinary code samples as code samples", () => {
  const source = `\`\`\`tsx
const Button = () => <button>Example</button>;
\`\`\``;

  expect(normalizeAssistantMdx(source)).toBe(source);
});
