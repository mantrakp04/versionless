const FENCED_SOURCE =
  /^```(?:mdx|jsx|tsx|javascript|typescript)\s*\n([\s\S]*?)\n```\s*$/i;
const DASHBOARD_DECLARATION =
  /\b(?:const|function)\s+(?:[A-Za-z_$][\w$]*)?Dashboard\b/;
const RETURNED_COMPONENT_TREE =
  /\breturn\s*\(\s*\n([\s\S]*?)\n\s*\);\s*\n\s*};?(?:\s*\n\s*export\s+default\s+[A-Za-z_$][\w$]*\s*;?)?\s*$/;

/**
 * Some models wrap otherwise declarative dashboard JSX in a conventional
 * React component example. Extract only the returned tree; the sandbox policy
 * still validates every element, attribute, and expression before execution.
 */
export function normalizeAssistantMdx(source: string): string {
  const fenced = source.trim().match(FENCED_SOURCE);
  if (!fenced) return source;

  const code = fenced[1]!.trim();
  if (code.startsWith("<")) return code;
  if (!DASHBOARD_DECLARATION.test(code)) return source;

  return code.match(RETURNED_COMPONENT_TREE)?.[1]?.trim() ?? source;
}
