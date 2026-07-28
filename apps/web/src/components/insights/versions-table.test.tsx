import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  defaultVersionSortDirection,
  VersionConfigSummary,
} from "./versions-table";

test("renders uploaded config stats as plain table text", () => {
  const html = renderToStaticMarkup(
    <VersionConfigSummary endpointCount={7} modelCount={2} />,
  );

  expect(html).toContain("7 endpoints · 2 models");
  expect(html).toContain("text-muted-foreground");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<svg");
});

test("keeps current versions first on the initial sunset sort", () => {
  expect(defaultVersionSortDirection("sunsetAfter")).toBe("desc");
  expect(defaultVersionSortDirection("version")).toBe("asc");
  expect(defaultVersionSortDirection("requests")).toBe("asc");
});
