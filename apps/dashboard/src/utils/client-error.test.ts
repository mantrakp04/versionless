import { describe, expect, test } from "bun:test";

import { clientErrorMessage } from "./client-error";

describe("client error presentation", () => {
  const internalError = new Error(
    "postgres://admin:secret@db.internal/versionless",
  );
  const friendly = "We could not load your data. Please try again.";

  test("never includes diagnostics in production copy", () => {
    const message = clientErrorMessage(internalError, friendly, false);

    expect(message).toBe(friendly);
    expect(message).not.toContain("secret");
  });

  test("includes friendly copy and diagnostics in development", () => {
    const message = clientErrorMessage(internalError, friendly, true);

    expect(message).toContain(friendly);
    expect(message).toContain("Developer details:");
    expect(message).toContain(internalError.message);
  });
});
