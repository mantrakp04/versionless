import { describe, expect, test } from "bun:test";

import { dismissBootstrapShell } from "./bootstrap";

describe("dismissBootstrapShell", () => {
  test("removes the static splash after the React root commits", () => {
    let removed = false;

    dismissBootstrapShell({
      getElementById: (id) =>
        id === "bootstrap-shell"
          ? {
              remove() {
                removed = true;
              },
            }
          : null,
    });

    expect(removed).toBe(true);
  });

  test("is safe when the splash is already gone", () => {
    expect(() =>
      dismissBootstrapShell({ getElementById: () => null }),
    ).not.toThrow();
  });
});
