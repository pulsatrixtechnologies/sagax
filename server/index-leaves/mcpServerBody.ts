// @ts-nocheck
/** mcpServerBody (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMcpServerBody(getHost: () => Host): any {
function mcpServerBody(body: unknown): Record<string, unknown> {
  const host = getHost();
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return out;
  const record = body as Record<string, unknown>;
  for (const key of ["command", "args", "env", "type", "url", "headers", "oauth", "enabled", "resultBudget"]) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  return out;
}
  return mcpServerBody;
}
