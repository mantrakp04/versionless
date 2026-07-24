import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TimeRangeControl } from "./time-range-control";

test("renders the shared ranges and marks the selected range as pressed", () => {
  const html = renderToStaticMarkup(
    <TimeRangeControl
      value={7}
      onValueChange={() => undefined}
      aria-label="Telemetry window"
    />,
  );

  expect(html).toContain('role="group"');
  expect(html).toContain('aria-label="Telemetry window"');
  expect(html).toContain("24h");
  expect(html).toContain("7d");
  expect(html).toContain("30d");
  expect(html).toContain('aria-pressed="true"');
  expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
});
