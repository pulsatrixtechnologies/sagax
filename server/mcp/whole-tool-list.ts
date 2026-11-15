// Whether an MCP tools/list answer is a whole list, not one page of it: the
// one rule for every place that keeps a server's tool list to answer the
// next engine start at once (the environment relay, #3623, and the gate of a
// connector the relay does not carry, #4394). A page is never kept: its
// later pages would be missing.
export function wholeToolList(result: unknown): result is { tools: unknown[]; nextCursor?: null | "" } & Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const value = result as { tools?: unknown; nextCursor?: unknown };
  return Array.isArray(value.tools) && (value.nextCursor === undefined || value.nextCursor === null || value.nextCursor === "");
}
