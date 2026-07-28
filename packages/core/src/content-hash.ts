/**
 * JSON stringify with all object keys sorted recursively, 2-space indent, and
 * a trailing newline. Snapshot producers and consumers share this exact byte
 * representation so an integrity hash cannot drift between packages.
 */
export function stableStringify(value: unknown): string {
  return `${stringify(value, "")}\n`;
}

function stringify(value: unknown, indent: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      // Mirror JSON.stringify: unsupported top-level/array values become null,
      // while unsupported object properties are omitted below.
      return "null";
  }

  const childIndent = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map(
      (item) => `${childIndent}${stringify(item, childIndent)}`,
    );
    return `[\n${items.join(",\n")}\n${indent}]`;
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort();
  if (keys.length === 0) return "{}";
  const entries = keys.map(
    (key) =>
      `${childIndent}${JSON.stringify(key)}: ${stringify(object[key], childIndent)}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

/** FNV-1a 32-bit hash, hex-encoded for the snapshot format-v1 contract. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
