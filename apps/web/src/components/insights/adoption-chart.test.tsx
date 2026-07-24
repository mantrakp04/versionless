import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildAdoptionSeries,
  formatAdoptionTick,
  AdoptionChartSkeleton,
  AdoptionLegend,
} from "./adoption-chart";

test("adoption skeleton preserves the chart footprint and exposes its loading state", () => {
  const html = renderToStaticMarkup(<AdoptionChartSkeleton />);

  expect(html).toContain('role="status"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aria-label="Loading adoption curve"');
  expect(html).toContain("h-64");
  expect(html).toContain("<svg");
  expect(html).toContain('aria-hidden="true"');
});

test("adoption legend exposes visible and hidden series as toggle buttons", () => {
  const html = renderToStaticMarkup(
    <AdoptionLegend
      versions={["2025-06-01", "2026-07-21"]}
      hiddenVersions={new Set(["2026-07-21"])}
      onToggle={() => undefined}
    />,
  );

  expect(html).toContain(
    'aria-label="Hide 2025-06-01" aria-pressed="true"',
  );
  expect(html).toContain(
    'aria-label="Show 2026-07-21" aria-pressed="false"',
  );
  expect(html).toContain(">2026-07-21</span>");
  expect(html).toContain("line-through");
});

test("keeps hourly adoption buckets distinct in the 24 hour view", () => {
  const { data } = buildAdoptionSeries([
    {
      bucket: "2026-07-24 05:00:00.000",
      version: "2026-07-24",
      clients: 1,
      requests: 12,
    },
    {
      bucket: "2026-07-24 06:00:00.000",
      version: "2026-07-24",
      clients: 1,
      requests: 8,
    },
  ]);

  expect(data).toHaveLength(2);
  expect(data.map((point) => point.bucket)).toEqual([
    "2026-07-24 05:00:00.000",
    "2026-07-24 06:00:00.000",
  ]);
  expect(formatAdoptionTick(String(data[0]?.bucket), true)).toBe("05:00");
});
