import { expect, test } from "bun:test";

import config from "./vite.config";

test("builds the dashboard under its public mount", () => {
  expect(config.base).toBe("/dashboard/");
  expect(config.build?.outDir).toBe("dist/dashboard");
});
