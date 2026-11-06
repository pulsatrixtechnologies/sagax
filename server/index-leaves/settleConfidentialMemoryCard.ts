// @ts-nocheck
/** settleConfidentialMemoryCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleConfidentialMemoryCard(getHost: () => Host): any {
async function settleConfidentialMemoryCard(auth: RequestAuth, threadId: string, requestId: string, behavior: string, rule?: "allow"): Promise<{ status: number; body: Record<string, unknown> }> {
  const host = getHost();

  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId && row.card.confidentialMemoryRequest);
  const card = message?.card;
  if (!message || !card) return { status: 404, body: { error: "No such request." } };
  if (card.answered || card.dismissed || card.expired) return { status: 409, body: { error: "The request is no longer open." } };
  if (auth.kind === "session" && auth.session.ephemeral === true) return { status: 403, body: { error: host.CONFIDENTIAL_CARD_DELEGATED } };
  const owner = host.confidentialThreadOwner(threadId);
  const caller = host.approvalCallerUserId(auth).trim().toLowerCase();
  if (!owner || !caller || caller !== owner) return { status: 403, body: { error: "Only this thread's owner can answer this request." } };
  // #2091: Always allow on this card keeps its rule before the answer goes out
  if (rule === "allow") {
    const refused = host.saveOwnerRuleFromCard(auth, threadId, requestId, "allow", behavior);
    if (refused) return { status: refused.status, body: { error: refused.error } };
  }
  const pending = host.pendingConfidentialMemory.get(requestId);
  host.pendingConfidentialMemory.delete(requestId);
  const actor = host.cwActionActor(auth);
  if (behavior !== "allow" || !pending || !actor) {
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny" } });
    return { status: 200, body: { ok: true, outcome: "rejected" } };
  }
  host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow" } });
  host.confidentialMemoryPasses.grant(threadId, pending.digest);
  const french = cwActionLanguage(host.languageOfRequest(auth)) === "fr";
  // the owner allowed it in person: the follow-up posts into exactly this
  // thread, never as an on-behalf request (which a confidential thread refuses)
  const sent = await host.performBotActRoute(actor, {
    kind: "route", method: "POST", path: `/api/bots/${pending.botId}/messages`,
    body: { text: french ? "Oui : fais exactement l'appel proposé sur la carte, avec les mêmes arguments." : "Yes: make exactly the call shown on the card, with the same arguments.", threadId }
  }, 8000, { continuation: threadId });
  if (sent.status >= 300) return { status: 502, body: { error: "The bot could not be asked to make the call. Try again." } };
  return { status: 200, body: { ok: true, outcome: "allowed-once" } };

}
  return settleConfidentialMemoryCard;
}
