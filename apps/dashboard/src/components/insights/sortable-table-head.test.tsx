import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SortableTableHead } from "./sortable-table-head";

test("exposes the active server sort through the table header", () => {
  const html = renderToStaticMarkup(
    <table>
      <thead>
        <tr>
          <SortableTableHead
            label="Requests"
            column="requests"
            sort="requests"
            direction="asc"
            onSort={() => undefined}
            align="right"
          />
        </tr>
      </thead>
    </table>,
  );

  expect(html).toContain('aria-sort="ascending"');
  expect(html).toContain(">Requests<");
  expect(html).toContain("text-right");
});
