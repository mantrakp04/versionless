import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { Accordion } from "@versionless/ui/components/accordion";

import { ErrorOccurrenceRecord } from "./error-occurrence-record";

test("renders each error occurrence as a collapsed accordion item", () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Accordion>
        <ErrorOccurrenceRecord
          expanded={false}
          index={0}
          occurrence={{
            traceId: "trace-safe-123",
            ts: "2026-07-24T20:15:00.000Z",
            durationMs: 812,
          }}
          projectId="11111111-1111-4111-8111-111111111111"
          signature={{
            version: "2026-06-01",
            route: "POST /v1/query",
            status: 500,
          }}
        />
      </Accordion>
    </QueryClientProvider>,
  );

  expect(html).toContain("Occurrence 1");
  expect(html).toContain("trace-safe-123");
  expect(html).toContain('data-slot="accordion-item"');
  expect(html).toContain('data-slot="accordion-trigger"');
  expect(html).not.toContain("exception.message");
  expect(html).not.toContain("stack");
});
