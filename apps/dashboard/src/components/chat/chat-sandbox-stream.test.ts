import { expect, test } from "bun:test";
import {
  STREAM_COMPILE_INTERVAL_MS,
  streamCompileDelay,
} from "./chat-sandbox-stream";

test("refreshes streaming MDX at a responsive cadence", () => {
  expect(STREAM_COMPILE_INTERVAL_MS).toBeLessThanOrEqual(50);
  expect(streamCompileDelay(true, 100, 115)).toBe(25);
  expect(streamCompileDelay(true, 100, 150)).toBe(0);
});

test("renders the completed answer immediately", () => {
  expect(streamCompileDelay(false, 100, 101)).toBe(0);
});
