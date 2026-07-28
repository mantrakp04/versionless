import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  CONSUMER_KEY_PREFIX,
  fingerprintConsumerKey,
} from "../src/fingerprint";

describe("consumer key fingerprint", () => {
  test("matches a real SHA-256 digest", () => {
    // Core carries no runtime deps, so SHA-256 is implemented in-package.
    // Pin it against the platform's implementation across input lengths that
    // straddle the 64-byte block and the 56-byte padding boundary.
    for (const input of [
      "",
      "a",
      "sk_live_9f2b41c7",
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(63),
      "x".repeat(64),
      "x".repeat(65),
      "x".repeat(200),
      "key-with-ünïcode-🔑",
    ]) {
      const expected = createHash("sha256").update(input).digest("hex");
      const fingerprint = fingerprintConsumerKey(input || "nonempty");
      if (!input) {
        // Blank input has no consumer to identify.
        expect(fingerprintConsumerKey(input)).toBeUndefined();
        continue;
      }
      expect(fingerprint).toBe(
        CONSUMER_KEY_PREFIX + expected.slice(0, 12),
      );
    }
  });

  test("never returns the raw key", () => {
    const secret = "sk_live_do_not_leak_this_value";
    const fingerprint = fingerprintConsumerKey(secret)!;

    expect(fingerprint).not.toContain(secret);
    expect(fingerprint).not.toContain("sk_live");
    expect(fingerprint).toStartWith(CONSUMER_KEY_PREFIX);
    expect(fingerprint).toHaveLength(CONSUMER_KEY_PREFIX.length + 12);
    expect(fingerprint.slice(CONSUMER_KEY_PREFIX.length)).toMatch(
      /^[0-9a-f]{12}$/,
    );
  });

  test("is stable and distinct across keys", () => {
    expect(fingerprintConsumerKey("key-a")).toBe(
      fingerprintConsumerKey("key-a"),
    );
    expect(fingerprintConsumerKey("key-a")).not.toBe(
      fingerprintConsumerKey("key-b"),
    );
    // Whitespace around a header value is not a different consumer.
    expect(fingerprintConsumerKey("  key-a  ")).toBe(
      fingerprintConsumerKey("key-a"),
    );
  });

  test("hashes a raw credential even when it resembles a fingerprint", () => {
    const secret = "c_deadbeefcafe";
    const expected = createHash("sha256").update(secret).digest("hex");

    expect(fingerprintConsumerKey(secret)).toBe(
      CONSUMER_KEY_PREFIX + expected.slice(0, 12),
    );
    expect(fingerprintConsumerKey(secret)).not.toBe(secret);
  });

  test("treats absent and blank keys as no consumer", () => {
    expect(fingerprintConsumerKey(undefined)).toBeUndefined();
    expect(fingerprintConsumerKey(null)).toBeUndefined();
    expect(fingerprintConsumerKey("")).toBeUndefined();
    expect(fingerprintConsumerKey("   ")).toBeUndefined();
  });

  test("stays uniform-width regardless of input size", () => {
    const widths = new Set(
      ["k", "k".repeat(500), "sk_live_" + "9".repeat(120)].map(
        (key) => fingerprintConsumerKey(key)!.length,
      ),
    );

    expect(widths).toEqual(new Set([CONSUMER_KEY_PREFIX.length + 12]));
  });
});
