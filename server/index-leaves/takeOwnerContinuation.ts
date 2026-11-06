// @ts-nocheck
/** takeOwnerContinuation (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTakeOwnerContinuation(getHost: () => Host): any {
function takeOwnerContinuation(token: string | undefined, method: string, path: string) {
  const host = getHost();

  if (!token) return null;
  const entry = host.ownerContinuations.get(token);
  if (entry?.route) {
    host.ownerContinuations.delete(token);
    return entry.expiresAt >= Date.now() && entry.route.method === method && entry.route.path === path ? entry.threadId : null;
  }
  // a bot's messages route (/api/bots/<id>/messages), nothing else
  const parts = path.split("/");
  if (method !== "POST" || parts.length !== 5 || parts[1] !== "api" || parts[2] !== "bots" || parts[4] !== "messages") return null;
  host.ownerContinuations.delete(token);
  return entry && entry.expiresAt >= Date.now() ? entry.threadId : null;

}
  return takeOwnerContinuation;
}
