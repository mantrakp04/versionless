type BootstrapDocument = {
  getElementById(id: string): { remove(): void } | null;
};

/**
 * The HTML shell covers the page until React has committed its first frame.
 * Remove it from the document rather than relying on CSS stacking so a stale
 * splash can never keep the mounted dashboard hidden.
 */
export function dismissBootstrapShell(document: BootstrapDocument): void {
  document.getElementById("bootstrap-shell")?.remove();
}
