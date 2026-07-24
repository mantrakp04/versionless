import { describe, expect, test } from "bun:test";
import { compilePattern, expandPath, normalizeRouteKey } from "../src/matcher";

describe("normalizeRouteKey", () => {
  test("normalizes params and trailing slashes", () => {
    expect(normalizeRouteKey("GET /users/:id")).toBe("GET /users/:*");
    expect(normalizeRouteKey("get /users/:userId/")).toBe("GET /users/:*");
    expect(normalizeRouteKey("POST /users")).toBe("POST /users");
    expect(normalizeRouteKey("GET /")).toBe("GET /");
  });
});

describe("compilePattern", () => {
  test("matches and captures params", () => {
    const p = compilePattern("GET /users/:id/posts/:postId");
    expect(p.match("GET", "/users/42/posts/7")).toEqual({ id: "42", postId: "7" });
    expect(p.match("get", "/users/42/posts/7")).toEqual({ id: "42", postId: "7" });
    expect(p.match("POST", "/users/42/posts/7")).toBeNull();
    expect(p.match("GET", "/users/42")).toBeNull();
    expect(p.match("GET", "/users/42/posts/7/extra")).toBeNull();
  });

  test("ignores query strings and decodes params", () => {
    const p = compilePattern("GET /users/:id");
    expect(p.match("GET", "/users/a%20b?x=1")).toEqual({ id: "a b" });
  });

  test("rejects wildcards", () => {
    expect(() => compilePattern("GET /users/*")).toThrow();
  });
});

describe("expandPath", () => {
  test("substitutes params into the target", () => {
    expect(expandPath("GET /teams/:id", { id: "42" })).toBe("/teams/42");
    expect(expandPath("GET /teams", {})).toBe("/teams");
  });

  test("throws on missing params", () => {
    expect(() => expandPath("GET /teams/:id", {})).toThrow();
  });
});
