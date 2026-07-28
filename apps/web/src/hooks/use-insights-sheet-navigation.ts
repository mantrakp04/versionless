import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

export function useInsightsSheetNavigation() {
  const navigate = useNavigate();
  const update = useCallback(
    (changes: { error?: string; version?: string }) => {
      void navigate({
        to: ".",
        search: (current) => ({ ...current, ...changes }),
      });
    },
    [navigate],
  );

  return {
    closeError: useCallback(() => update({ error: undefined }), [update]),
    closeVersion: useCallback(() => update({ version: undefined }), [update]),
    openError: useCallback(
      (error: string) => update({ error, version: undefined }),
      [update],
    ),
    openVersion: useCallback(
      (version: string) => update({ error: undefined, version }),
      [update],
    ),
  };
}
