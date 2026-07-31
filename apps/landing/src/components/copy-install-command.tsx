"use client";

import { useEffect, useRef, useState } from "react";

const SETUP_PROMPT = "setup <docs_server>/SKILL.md";

export function CopyInstallCommand() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyPrompt() {
    await navigator.clipboard.writeText(SETUP_PROMPT);
    setCopied(true);

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="install-command">
      <code>
        <span aria-hidden>$ </span>
        {SETUP_PROMPT}
      </code>
      <button
        aria-label={copied ? "Setup prompt copied" : "Copy setup prompt"}
        className="copy-command"
        onClick={copyPrompt}
        type="button"
      >
        <span aria-live="polite">{copied ? "copied" : "copy prompt"}</span>
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
