/** External runtime allow-list for /api/internal (#1388): list its peers,
 * ask, delegate or coordinate them, and read its delegations and assignments. */
export function externalRuntimeMayCall(method: string, path: string): boolean {
  if (method === "GET") {
    return path === "/api/internal/agents" || path === "/api/internal/assignment-status"
      || /^\/api\/internal\/delegations\/[\w-]+$/.test(path);
  }
  return method === "POST" && (path === "/api/internal/ask-bot" || path === "/api/internal/delegate-bot"
    || path === "/api/internal/coordinate-bots");
}
