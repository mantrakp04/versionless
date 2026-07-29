import { expect, test } from "bun:test";

import { displayOtlpBody } from "./telemetry";

test("formats OTLP AnyValue bodies without hiding arbitrary JSON", () => {
  expect(displayOtlpBody('{"stringValue":"worker started"}')).toBe(
    "worker started",
  );
  expect(displayOtlpBody('{"kvlistValue":{"values":[]}}')).toContain(
    '"kvlistValue"',
  );
  expect(displayOtlpBody("plain text")).toBe("plain text");
});
