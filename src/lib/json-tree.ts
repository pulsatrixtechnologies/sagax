// Pure helpers of the in-app JSON viewer (src/components/JsonViewer.tsx): the
// parse with a clear failure, the row summary of a node and the paths an
// "expand all" opens. No DOM, so the tree's rules are tested without one.

export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export const JSON_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Children drawn per node before a "Show more" row. */
export const JSON_PAGE = 200;
/** Nodes "Expand all" opens at most, so a huge file never mounts everything. */
export const JSON_EXPAND_ALL_LIMIT = 2000;
export const ROOT_PATH = "$";

export function isJsonName(name: string): boolean {
  return /\.(json|jsonc|geojson)$/i.test(name.trim());
}

export function jsonKind(value: unknown): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "object";
  }
}

/** [key, child] pairs of an object or array, in file order. */
export function jsonChildren(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.map((child, index) => [String(index), child]);
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>);
  return [];
}

export function childPath(path: string, key: string): string {
  return `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/** Parse the text, or null when it is not valid JSON (a BOM is allowed). */
export function parseJsonText(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) };
  } catch {
    return null;
  }
}

/** The paths of every container, breadth first, up to `limit`. */
export function expandAllPaths(root: unknown, limit = JSON_EXPAND_ALL_LIMIT): Set<string> {
  const open = new Set<string>();
  const queue: Array<[string, unknown]> = [[ROOT_PATH, root]];
  while (queue.length > 0 && open.size < limit) {
    const [path, value] = queue.shift()!;
    const kind = jsonKind(value);
    if (kind !== "object" && kind !== "array") continue;
    open.add(path);
    for (const [key, child] of jsonChildren(value).slice(0, JSON_PAGE)) queue.push([childPath(path, key), child]);
  }
  return open;
}
