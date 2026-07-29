import { expect, test } from "bun:test";

import {
  MAX_SANDBOX_HEIGHT,
  MIN_SANDBOX_HEIGHT,
  normalizeSandboxHeight,
} from "./sandbox-height";

test("expands a long dashboard instead of clamping it to an internal scroller", () => {
  expect(normalizeSandboxHeight(1_710.25)).toBe(1_711);
});

test("keeps empty and hostile height reports within layout safety bounds", () => {
  expect(normalizeSandboxHeight(0)).toBe(MIN_SANDBOX_HEIGHT);
  expect(normalizeSandboxHeight(Number.MAX_VALUE)).toBe(MAX_SANDBOX_HEIGHT);
});
