import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DashboardTable,
  DashboardTableSkeleton,
  getNextActiveIndex,
  isRowActivationKey,
  navigationStateAtIndex,
  resolveRestoredIndex,
  virtualTableStorageKey,
} from "./dashboard-table";

describe("infinite virtual table keyboard navigation", () => {
  test("supports vim and arrow shortcuts without leaving the list", () => {
    expect(getNextActiveIndex("j", 1, 4)).toBe(2);
    expect(getNextActiveIndex("ArrowDown", 3, 4)).toBe(3);
    expect(getNextActiveIndex("k", 1, 4)).toBe(0);
    expect(getNextActiveIndex("ArrowUp", 0, 4)).toBe(0);
    expect(getNextActiveIndex("Home", 3, 4)).toBe(0);
    expect(getNextActiveIndex("End", 0, 4)).toBe(3);
    expect(getNextActiveIndex("Enter", 1, 4)).toBeNull();
  });

  test("recognizes keyboard row activation without treating navigation as activation", () => {
    expect(isRowActivationKey("Enter")).toBeTrue();
    expect(isRowActivationKey(" ")).toBeTrue();
    expect(isRowActivationKey("ArrowDown")).toBeFalse();
  });

  test("scopes persisted indexes to each component instance", () => {
    expect(virtualTableStorageKey("versions:project-a")).not.toBe(
      virtualTableStorageKey("versions:project-b"),
    );
  });

  test("restores a stable row key before falling back to a clamped index", () => {
    const rows = [{ id: "new" }, { id: "saved" }, { id: "old" }];
    expect(
      resolveRestoredIndex(
        rows,
        { index: 0, itemKey: "saved" },
        (row) => row.id,
      ),
    ).toBe(1);
    expect(
      resolveRestoredIndex(
        rows,
        { index: 20, itemKey: "missing" },
        (row) => row.id,
      ),
    ).toBe(2);
  });

  test("updates the preserved index and stable key from a pointer-selected row", () => {
    const rows = [{ id: "first" }, { id: "hovered" }, { id: "last" }];

    expect(navigationStateAtIndex(rows, 1, (row) => row.id)).toEqual({
      index: 1,
      itemKey: "hovered",
    });
    expect(navigationStateAtIndex(rows, 5, (row) => row.id)).toBeNull();
  });
});

test("renders a configurable table loading skeleton", () => {
  const html = renderToStaticMarkup(
    <DashboardTableSkeleton
      gridTemplateColumns="2fr 1fr"
      renderHeader={() => (
        <>
          <th>Name</th>
          <th>Count</th>
        </>
      )}
      rows={3}
      rowHeight={44}
      columnWidths={["8rem", "3rem"]}
    />,
  );

  expect(html).toContain('aria-busy="true"');
  expect(html.match(/data-skeleton-row/g)).toHaveLength(3);
  expect(html).toContain("min-height:44px");
  expect(html).toContain("width:8rem");
});

test("renders a plain table skeleton when no grid template is provided", () => {
  const html = renderToStaticMarkup(
    <DashboardTableSkeleton renderHeader={() => <th>Name</th>} rows={2} />,
  );

  expect(html).toContain('aria-busy="true"');
  expect(html.match(/data-skeleton-row/g)).toHaveLength(2);
  expect(html).not.toContain("grid-template-columns");
});

test("renders finite rows, expansion, and shared empty state through one API", () => {
  const table = renderToStaticMarkup(
    <DashboardTable
      items={[{ id: "trace-1", route: "/users" }]}
      getItemKey={(row) => row.id}
      gridTemplateColumns="2fr 1fr"
      renderHeader={() => <th>Route</th>}
      renderRow={(row) => <td>{row.route}</td>}
      selectedKey="trace-1"
      onRowActivate={() => {}}
      isRowExpanded={() => true}
      renderExpandedRow={() => <div>Span detail</div>}
      columnCount={1}
    />,
  );
  const empty = renderToStaticMarkup(
    <DashboardTable
      items={[] as { id: string }[]}
      getItemKey={(row) => row.id}
      renderHeader={() => <th>Route</th>}
      renderRow={() => null}
      emptyState="No traces yet."
    />,
  );

  expect(table).toContain("Keyboard navigable data table");
  expect(table).toContain('data-dashboard-sticky-table=""');
  expect(table).toContain('aria-selected="true"');
  expect(table).toContain("grid-template-columns:2fr 1fr");
  expect(table).toContain("sticky top-0");
  expect(table).toContain("grid-column:1 / -1");
  expect(table).toContain("Span detail");
  expect(empty).toContain("No traces yet.");
  expect(empty).not.toContain("<table");
});

test("uses the finite row index to disambiguate duplicate logical records", () => {
  const duplicateRecords = [
    { logicalKey: "log:same-timestamp:versionless.request" },
    { logicalKey: "log:same-timestamp:versionless.request" },
  ];
  const html = renderToStaticMarkup(
    <DashboardTable
      items={duplicateRecords}
      getItemKey={(record, index) => `${record.logicalKey}:${index}`}
      renderHeader={() => <th>Signal</th>}
      renderRow={(_, index) => <td>record {index + 1}</td>}
      selectedKey={`${duplicateRecords[1]!.logicalKey}:1`}
      onRowActivate={() => {}}
      isRowExpanded={(_, index) => index === 1}
      renderExpandedRow={(_, index) => <div>detail {index + 1}</div>}
      columnCount={1}
    />,
  );

  expect(html).toContain(
    'data-row-key="log:same-timestamp:versionless.request:0"',
  );
  expect(html).toContain(
    'data-row-key="log:same-timestamp:versionless.request:1"',
  );
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(html).toContain("detail 2");
});
