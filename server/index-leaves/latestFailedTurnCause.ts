// @ts-nocheck
/** latestFailedTurnCause (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLatestFailedTurnCause(getHost: () => Host): any {
function latestFailedTurnCause(threadId: string) {
  const host = getHost();

  const messages = host.store.messagesFor(threadId);
  for (let index = messages.length - 1, seen = 0; index >= 0 && seen < 40; index--, seen++) {
    const message = messages[index]!;
    const cause = message.kind === "activity" && message.tool?.name ? host.failedTurnCause(message.tool.name) : null;
    if (cause) return cause;
    if (message.role === "user") return null;
  }
  return null;

}
  return latestFailedTurnCause;
}
