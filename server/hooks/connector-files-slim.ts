// #5140: what the connector-files hook helper (omb-hook connector-files)
// sends Sagax of a tool result, and how it puts Sagax's answer back. A
// result that shows the model a picture carries the picture's base64, often
// over the hook route's 1 MB body: Sagax needs only the strings that name a
// file the engine saved, so every other string travels as null and keeps its
// place, and the helper rebuilds the whole result from Sagax's rewritten
// strings. Pure, no dependency: the helper runs on every such tool call.

/** What a string names when it names a file Claude Code saved from an MCP
 * result (`mcp-<server>-blob-...`, a read resource's `mcp-resource-...`). */
export const ENGINE_FILE_MARKERS = ["-blob-", "mcp-resource-"] as const;

const MAX_DEPTH = 8;

/** Whether a string may name one of those files. */
export function namesEngineFile(text: string): boolean {
  return ENGINE_FILE_MARKERS.some((marker) => text.includes(marker));
}

/** The result with only the strings that may name such a file; every other
 * value is null in its place. */
export function slimToolResponse(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return namesEngineFile(value) ? value : null;
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => slimToolResponse(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, slimToolResponse(item, depth + 1)]));
}

/** The original result with each string Sagax rewrote put back in its place;
 * anything else stays as the engine had it. */
export function mergeToolResponse(original: unknown, answer: unknown, depth = 0): unknown {
  if (typeof original === "string") return typeof answer === "string" && namesEngineFile(original) ? answer : original;
  if (!original || typeof original !== "object" || !answer || typeof answer !== "object" || depth > MAX_DEPTH) return original;
  if (Array.isArray(original)) {
    return Array.isArray(answer) ? original.map((item, index) => mergeToolResponse(item, answer[index], depth + 1)) : original;
  }
  const rewritten = answer as Record<string, unknown>;
  return Object.fromEntries(Object.entries(original).map(([key, item]) => [key, mergeToolResponse(item, rewritten[key], depth + 1)]));
}
