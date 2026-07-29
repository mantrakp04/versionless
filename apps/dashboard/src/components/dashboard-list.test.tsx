import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  collectionStateAtIndex,
  getNextCollectionIndex,
  resolveCollectionIndex,
} from "./dashboard-collection";
import { DashboardList, DashboardListSkeleton } from "./dashboard-list";

describe("shared dashboard collection navigation", () => {
  test("supports arrows, vim keys, and collection boundary shortcuts", () => {
    expect(getNextCollectionIndex("j", 1, 5)).toBe(2);
    expect(getNextCollectionIndex("ArrowUp", 1, 5)).toBe(0);
    expect(getNextCollectionIndex("Home", 3, 5)).toBe(0);
    expect(getNextCollectionIndex("End", 1, 5)).toBe(4);
  });

  test("restores a stable item key after collection order changes", () => {
    const items = [{ id: "latest" }, { id: "remembered" }, { id: "oldest" }];
    const state = collectionStateAtIndex(items, 1, (item) => item.id);

    expect(state).toEqual({ index: 1, itemKey: "remembered" });
    expect(
      resolveCollectionIndex(
        [items[2]!, items[0]!, items[1]!],
        state!,
        (item) => item.id,
      ),
    ).toBe(2);
  });
});

test("renders compact records through the shared interactive list shell", () => {
  const html = renderToStaticMarkup(
    <DashboardList
      items={[{ id: "error-1", label: "GET /v1/users" }]}
      getItemAriaLabel={(item) => `Inspect ${item.label}`}
      getItemKey={(item) => item.id}
      navigationKey="errors:project-a"
      onItemActivate={() => {}}
      renderItem={(item) => <span>{item.label}</span>}
      scrollAreaClassName="h-72"
      selectedKey="error-1"
    />,
  );

  expect(html).toContain("Keyboard navigable data list");
  expect(html).toContain('role="list"');
  expect(html).toContain('role="listitem"');
  expect(html).toContain('aria-label="Inspect GET /v1/users"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain('data-state="selected"');
  expect(html).toContain('data-slot="scroll-area"');
  expect(html).toContain("J, K, Home, End");
});

test("shares skeleton and empty-state behavior with data tables", () => {
  const skeleton = renderToStaticMarkup(
    <DashboardListSkeleton rows={3} rowHeight={64} />,
  );
  const empty = renderToStaticMarkup(
    <DashboardList
      items={[] as { id: string }[]}
      getItemKey={(item) => item.id}
      renderItem={() => null}
      emptyState="No recent errors."
    />,
  );

  expect(skeleton).toContain('aria-busy="true"');
  expect(skeleton.match(/data-skeleton-item/g)).toHaveLength(3);
  expect(skeleton).toContain("min-height:64px");
  expect(empty).toContain("No recent errors.");
  expect(empty).not.toContain('role="list"');
});

test("supports layout-matched skeleton items", () => {
  const skeleton = renderToStaticMarkup(
    <DashboardListSkeleton
      contentClassName="grid sm:grid-cols-2"
      renderItem={(index) => <article>Loading project {index + 1}</article>}
      rowHeight={180}
      rows={2}
    />,
  );

  expect(skeleton).toContain("grid sm:grid-cols-2");
  expect(skeleton.match(/data-skeleton-item/g)).toHaveLength(2);
  expect(skeleton.match(/<article>/g)).toHaveLength(2);
  expect(skeleton).toContain("min-height:180px");
});
