import type { SandboxRenderMessage } from "./sandbox-protocol";

interface SandboxThemeRoot {
  classList: {
    toggle(token: string, force?: boolean): boolean;
  };
  style: {
    colorScheme: string;
  };
}

export function applySandboxTheme(
  root: SandboxThemeRoot,
  theme: SandboxRenderMessage["theme"],
) {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}
