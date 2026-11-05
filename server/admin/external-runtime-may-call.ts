/** External runtime allow-list for /api/internal (#1388). Pure move. */
export function externalRuntimeMayCall(method: string, path: string): boolean {
  if (method === "GET") return path === "/api/internal/agents" || /^\/api\/internal\/delegations\/[\w-]+$/.test(path);
  return method === "POST" && (path === "/api/internal/ask-bot" || path === "/api/internal/delegate-bot");
}
