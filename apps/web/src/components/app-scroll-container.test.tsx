import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppScrollContainer } from "./app-scroll-container";

test("bounds app content and owns vertical scrolling", () => {
  const html = renderToStaticMarkup(
    <AppScrollContainer>
      <div style={{ height: 2_000 }}>Long page</div>
    </AppScrollContainer>,
  );

  expect(html).toContain('data-slot="app-scroll-container"');
  expect(html).toContain("min-h-0");
  expect(html).toContain("flex-1");
  expect(html).toContain("overflow-y-auto");
  expect(html).toContain("scrollbar-gutter-stable");
});
