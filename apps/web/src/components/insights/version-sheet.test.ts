import { expect, test } from "bun:test";
import { sheetOverlayClasses } from "@versionless/ui/components/sheet";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VersionSheetSkeleton } from "./version-details-sheet";

test("the version detail sheet can dim the inventory without blurring it", () => {
  const classes = sheetOverlayClasses(false, "bg-black/25");

  expect(classes).toContain("backdrop-blur-none");
  expect(classes).toContain("bg-black/25");
  expect(classes).not.toContain("backdrop-blur-xs");
});

test("the version detail sheet renders a layout-matched loading skeleton", () => {
  const html = renderToStaticMarkup(createElement(VersionSheetSkeleton));

  expect(html).toContain('role="status"');
  expect(html).toContain("Loading version details");
  expect(html.match(/data-slot="skeleton"/g)?.length).toBeGreaterThanOrEqual(9);
});

test("the shared sheet uses an interruptible full-width slide transition", () => {
  const source = Bun.file(
    new URL(
      "../../../../../packages/ui/src/components/sheet.tsx",
      import.meta.url,
    ),
  );

  return source.text().then((contents) => {
    expect(contents).toContain("cubic-bezier(0.32,0.72,0,1)");
    expect(contents).toContain("data-starting-style:translate-x-full");
    expect(contents).toContain("motion-reduce:transform-none");
  });
});
