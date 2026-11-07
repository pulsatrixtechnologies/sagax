// @ts-nocheck
/** stoppedTurnText (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStoppedTurnText(getHost: () => Host): any {
function stoppedTurnText(threadId: string, turnId: string | undefined, cause?: string, stopReason?: string | null) {
  const host = getHost();

  const stop = host.turnStops.read(threadId, turnId);
  const reason = cause ?? stop?.cause ?? stop?.error ?? `The turn did not complete (${stopReason?.trim() || "no reason given"})`;
  const said = turnId ? host.store.messagesFor(threadId).findLast(message =>
    message.role === "bot" && message.kind === "text" && message.turnId === turnId)?.text : undefined;
  return host.stoppedTurnOutcome({
    reason, activities: host.store.activePath(threadId), turnId,
    // a provider's error sent as a reply is the cause, said once
    ...(said && said.trim() !== reason.trim() ? { said } : {}),
  });

}
  return stoppedTurnText;
}
