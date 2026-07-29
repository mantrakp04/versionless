import { expect, test } from "bun:test";

import { docsHref } from "./docs-link";

test("links to the local docs app in development and the mounted path in production", () => {
  expect(docsHref(true)).toBe("http://localhost:3002/docs");
  expect(docsHref(false)).toBe("/docs");
});
