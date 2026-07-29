import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import Loader, {
  AppShellSkeleton,
  HorizontalBarChartSkeleton,
  SunsetCardSkeleton,
} from "./loader";

describe("dashboard loading skeletons", () => {
  test("renders layout-shaped fallbacks without spinner animations", () => {
    const html = [
      <Loader />,
      <AppShellSkeleton />,
      <SunsetCardSkeleton />,
      <HorizontalBarChartSkeleton />,
    ]
      .map((component) => renderToStaticMarkup(component))
      .join("");

    expect(html).toContain('aria-label="Loading dashboard"');
    expect(html).toContain('aria-label="Loading sunset blockers"');
    expect(html).toContain('aria-label="Loading version overhead chart"');
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain('data-slot="spinner"');
  });
});
