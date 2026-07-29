import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildAdoptionSeries,
  formatAdoptionTick,
  getDefaultAdoptionVersions,
  AdoptionChartSkeleton,
  AdoptionLegend,
  ADOPTION_CHART_COLORS,
  MAX_ADOPTION_VERSIONS,
  resolveActiveAdoptionVersions,
  toggleAdoptionVersion,
} from "./adoption-chart";

test("uses distinct, readable colors for adoption versions", () => {
  expect(ADOPTION_CHART_COLORS).toEqual([
    "#2563eb",
    "#ea580c",
    "#059669",
    "#7c3aed",
    "#db2777",
  ]);
  expect(new Set(ADOPTION_CHART_COLORS).size).toBe(MAX_ADOPTION_VERSIONS);
});

test("adoption skeleton preserves the chart footprint and exposes its loading state", () => {
  const html = renderToStaticMarkup(<AdoptionChartSkeleton />);

  expect(html).toContain('role="status"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aria-label="Loading adoption curve"');
  expect(html).toContain("h-64");
  expect(html).toContain("<svg");
  expect(html).toContain('aria-hidden="true"');
});

test("defaults to the latest adoption versions and enforces the cap", () => {
  const versions = [
    "2024-03-01",
    "2025-01-01",
    "2026-07-24",
    "2025-06-01",
    "2026-07-21",
    "2026-05-14",
  ];
  const defaults = getDefaultAdoptionVersions(versions);

  expect(defaults).toEqual([
    "2026-07-24",
    "2026-07-21",
    "2026-05-14",
    "2025-06-01",
    "2025-01-01",
  ]);
  expect(defaults).toHaveLength(MAX_ADOPTION_VERSIONS);
  // At the cap, a sixth version is refused rather than silently evicting one
  // the reader deliberately turned on.
  expect([...toggleAdoptionVersion(new Set(defaults), "2024-03-01")]).toEqual(
    defaults,
  );

  const withoutMiddle = toggleAdoptionVersion(new Set(defaults), "2026-07-21");
  expect([...toggleAdoptionVersion(withoutMiddle, "2024-03-01")]).toEqual([
    "2026-07-24",
    "2026-05-14",
    "2025-06-01",
    "2025-01-01",
    "2024-03-01",
  ]);
});

test("allows every adoption version to be disabled", () => {
  const versions = ["2026-07-21", "2026-05-14", "2025-01-01"];

  expect(resolveActiveAdoptionVersions(new Set(), versions, versions)).toEqual(
    [],
  );
  expect(
    resolveActiveAdoptionVersions(
      new Set(["no-longer-in-range"]),
      versions,
      versions,
    ),
  ).toEqual(versions);
});

test("adoption legend shows only active series and a version picker", () => {
  const html = renderToStaticMarkup(
    <AdoptionLegend
      activeVersions={["2026-07-24", "2026-07-21", "2026-05-14"]}
      versions={["2025-06-01", "2026-05-14", "2026-07-21", "2026-07-24"]}
      onToggle={() => undefined}
    />,
  );

  expect(html).toContain("2026-07-24");
  expect(html).toContain("2026-07-21");
  expect(html).toContain("2026-05-14");
  expect(html).not.toContain("2025-06-01");
  expect(html).toContain('aria-label="Hide version 2026-05-14"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-label="Choose chart versions"');
  expect(html).toContain('title="Choose chart versions"');
  expect(html).not.toContain("Versions 3/5");
  expect(html).not.toContain("Show up to 5 versions");
});

test("keeps hourly adoption buckets distinct in the 24 hour view", () => {
  const { data } = buildAdoptionSeries(
    [
      {
        bucket: "2026-07-24 05:00:00.000",
        version: "2026-07-24",
        clients: 3,
        requests: 12,
      },
      {
        bucket: "2026-07-24 06:00:00.000",
        version: "2026-07-24",
        clients: 2,
        requests: 8,
      },
    ],
    { hourly: true, now: new Date("2026-07-24T06:30:00.000Z") },
  );

  expect(data).toHaveLength(25);
  expect(data[0]).toMatchObject({
    bucket: "2026-07-23 06:00:00",
    "2026-07-24": 0,
    "2026-07-24 clients": 0,
  });
  expect(data.at(-2)).toMatchObject({
    bucket: "2026-07-24 05:00:00",
    "2026-07-24": 12,
    "2026-07-24 clients": 3,
  });
  expect(data.at(-1)).toMatchObject({
    bucket: "2026-07-24 06:00:00",
    "2026-07-24": 8,
    "2026-07-24 clients": 2,
  });
  expect(formatAdoptionTick(String(data[0]?.bucket), true)).toBe("06:00");
});

test("keeps the hourly no-data state empty", () => {
  expect(
    buildAdoptionSeries([], {
      hourly: true,
      now: new Date("2026-07-24T06:30:00.000Z"),
    }).data,
  ).toEqual([]);
});
