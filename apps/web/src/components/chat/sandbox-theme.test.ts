import { expect, test } from "bun:test";

import { applySandboxTheme } from "./sandbox-theme";

function themeRoot() {
  const classes = new Set<string>();
  return {
    classes,
    root: {
      classList: {
        toggle(token: string, force = false) {
          if (force) classes.add(token);
          else classes.delete(token);
          return force;
        },
      },
      style: { colorScheme: "" },
    },
  };
}

test("applies dark mode to both component tokens and native controls", () => {
  const { classes, root } = themeRoot();

  applySandboxTheme(root, "dark");

  expect(classes.has("dark")).toBe(true);
  expect(root.style.colorScheme).toBe("dark");
});

test("removes dark mode when the parent switches to light", () => {
  const { classes, root } = themeRoot();
  classes.add("dark");

  applySandboxTheme(root, "light");

  expect(classes.has("dark")).toBe(false);
  expect(root.style.colorScheme).toBe("light");
});
