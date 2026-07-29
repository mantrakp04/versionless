"use client";

import { useEffect, useRef, useState } from "react";

const INSTALL_COMMAND = "bun add @versionless/core";

export function CopyInstallCommand() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyCommand() {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="install-command">
      <code>
        <span aria-hidden>$ </span>
        {INSTALL_COMMAND}
      </code>
      <button
        aria-label={
          copied ? "Install command copied" : "Copy install command"
        }
        className="copy-command"
        onClick={copyCommand}
        type="button"
      >
        <span aria-live="polite">{copied ? "copied" : "copy"}</span>
        <svg aria-hidden viewBox="0 0 18 18">
          {copied ? (
            <path d="m3.5 9.5 3.2 3.2 7.8-8" />
          ) : (
            <>
              <rect height="9" width="9" x="5.5" y="2.5" />
              <path d="M12.5 14.5h-9v-9" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
