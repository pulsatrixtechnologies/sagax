// @ts-nocheck
/** openPersonCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOpenPersonCard(getHost: () => Host): any {
function openPersonCard(threadId: string, exceptRequestId?: string): { kind: "approval" | "question" | "review"; tool?: string } | undefined {
  const host = getHost();

  const messages = host.store.messagesFor(threadId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const card = messages[i]!.kind === "options" ? messages[i]!.card : undefined;
    // 2026-11-08 (#2922): the card a request.resolved settles is still unpatched
    // while that event runs, so the caller can leave it out
    if (exceptRequestId && card?.requestId === exceptRequestId) continue;
    const kind = host.liveCardKind(card);
    if (kind) return { kind, tool: card?.tool };
  }
  return undefined;

}
  return openPersonCard;
}
