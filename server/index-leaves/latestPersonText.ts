// @ts-nocheck
/** latestPersonText (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLatestPersonText(getHost: () => Host): any {
function latestPersonText(threadId: string) {
  const host = getHost();

  const requestId = host.directRequestOwners.get(threadId)?.messageId;
  if (requestId) {
    const request = host.store.messagesFor(threadId).find((row) => row.id === requestId);
    if (request?.role === "user" && typeof request.text === "string") return request.text;
  }
  const path = host.store.activePath(threadId);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const row = path[i]!;
    if (row.role === "user" && typeof row.text === "string") return row.text;
  }
  return undefined;

}
  return latestPersonText;
}
