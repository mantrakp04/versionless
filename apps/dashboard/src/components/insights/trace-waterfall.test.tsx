import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildTraceTimeline,
  traceTimelineMetadata,
  TraceWaterfall,
  TraceWaterfallSkeleton,
  type WaterfallEvent,
  type WaterfallSpan,
} from "./trace-waterfall";

const spans: WaterfallSpan[] = [
  {
    spanId: "root",
    parentSpanId: null,
    name: "versionless.exchange",
    startMs: 100,
    durationMs: 50,
    hasError: false,
    attrs: {
      "versionless.route": "GET /v1/balances/:id",
      "versionless.version": "2024-11-01",
    },
  },
  {
    spanId: "failed",
    parentSpanId: "root",
    name: "versionless.transform.down",
    startMs: 110,
    durationMs: 8,
    hasError: true,
    attrs: {
      "versionless.change": "2025-01-01",
    },
  },
];
const events: WaterfallEvent[] = [
  {
    id: "request-log",
    name: "versionless.request",
    startMs: 115,
    severity: "ERROR",
    errorBody: {
      code: "not_found",
      message: "The requested resource was not found.",
    },
    parentSpanId: "root",
    attrs: {
      "http.response.status_code": "404",
    },
  },
];

test("renders a waterfall-shaped loading skeleton", () => {
  const html = renderToStaticMarkup(<TraceWaterfallSkeleton />);

  expect(html).toContain('aria-label="Loading trace detail"');
  expect(html).toContain('role="status"');
  expect(html.match(/data-slot="skeleton"/g)).toHaveLength(12);
  expect(html).not.toContain("animate-spin");
});

test("places timestamped logs inside the shared span waterfall", () => {
  expect(
    buildTraceTimeline(spans, events).map((row) =>
      row.kind === "span" ? row.span.name : row.event.name,
    ),
  ).toEqual([
    "versionless.exchange",
    "versionless.transform.down",
    "versionless.request",
  ]);

  const html = renderToStaticMarkup(
    <TraceWaterfall events={events} spans={spans} />,
  );
  expect(html).toContain("versionless.exchange");
  expect(html).toContain("versionless.transform.down");
  expect(html).toContain("versionless.request");
  expect(html).toContain("ERROR");
  expect(html).toContain("+15.0 ms");
  expect(html.match(/<button/g)).toHaveLength(3);
  expect(html.match(/aria-expanded=\"false\"/g)).toHaveLength(3);
});

test("exposes safe span and event metadata for the selected timeline row", () => {
  const rows = buildTraceTimeline(spans, events);
  const spanMetadata = traceTimelineMetadata(rows[0]!, 100);
  const eventMetadata = traceTimelineMetadata(rows[2]!, 100);

  expect(spanMetadata).toContainEqual({
    label: "versionless.route",
    value: "GET /v1/balances/:id",
  });
  expect(spanMetadata).toContainEqual({
    label: "Span ID",
    value: "root",
  });
  expect(eventMetadata).toContainEqual({
    label: "http.response.status_code",
    value: "404",
  });
  expect(eventMetadata).toContainEqual({
    label: "Severity",
    value: "ERROR",
  });
  expect(eventMetadata).toContainEqual({
    label: "Error body",
    value:
      '{"code":"not_found","message":"The requested resource was not found."}',
  });
});
