import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RecentErrorList } from "./error-overview";

test("renders aggregated safe error context without exception details", () => {
  const html = renderToStaticMarkup(
    <RecentErrorList
      errors={[
        {
          latestAt: "2026-07-24T20:15:00.000Z",
          version: "2026-06-01",
          route: "POST /v1/query",
          status: 500,
          occurrences: 12,
          latestDurationMs: 812,
        },
      ]}
      onErrorClick={() => {}}
    />,
  );

  expect(html).toContain("2026-06-01");
  expect(html).toContain("POST /v1/query");
  expect(html).toContain("500");
  expect(html).toContain("12");
  expect(html).toContain("812 ms");
  expect(html).toContain('data-slot="scroll-area"');
  expect(html).toContain(
    'aria-label="Inspect 12 occurrences of POST /v1/query"',
  );
  expect(html).toContain('aria-label="HTTP status 500"');
  expect(html).not.toContain("exception");
  expect(html).not.toContain("stack");
});
