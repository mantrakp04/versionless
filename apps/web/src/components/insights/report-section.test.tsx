import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Report, ReportControls, ReportSection } from "./report-section";
import { Sparkline } from "./report-visuals";

function renderReport(defaultExpanded: boolean) {
  return renderToStaticMarkup(
    <Report defaultExpanded={defaultExpanded}>
      <ReportControls />
      <ReportSection
        id="shape"
        index="01"
        metric={164}
        metricLabel="endpoints"
        qualifier="+13 vs 2026-06-14"
        title="Shape of the contract"
        verdict="Growing"
        verdictTone="positive"
        visual={<Sparkline values={[128, 151, 164]} />}
      >
        <p>Detailed shape breakdown</p>
      </ReportSection>
    </Report>,
  );
}

test("a collapsed section states itself with a verdict, a number and a visual", () => {
  const html = renderReport(false);

  expect(html).toContain("Shape of the contract");
  expect(html).toContain("Growing");
  expect(html).toContain(">164<");
  expect(html).toContain("+13 vs 2026-06-14");
  expect(html).toContain("<polyline");
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("Expand all");
  expect(html).not.toContain("Detailed shape breakdown");
});

test("expand-all opens every section and flips the control", () => {
  const html = renderReport(true);

  expect(html).toContain("Detailed shape breakdown");
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain("Collapse all");
});

test("each section is a landmark with a numbered index", () => {
  const html = renderReport(false);

  expect(html).toContain("<section");
  expect(html).toContain(">01<");
  expect(html).toContain('data-slot="collapsible-trigger"');
});

test("the collapsed visual is decorative, not something a reader must parse", () => {
  const html = renderReport(false);

  expect(html).toContain('aria-hidden="true"');
  // No axis labels or tick text leak out of the inline visual.
  expect(html).not.toContain("<text");
});
