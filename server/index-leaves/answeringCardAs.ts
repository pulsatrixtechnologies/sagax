// @ts-nocheck
/** answeringCardAs (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAnsweringCardAs(getHost: () => Host): any {
async function answeringCardAs(auth: RequestAuth, threadId: string, requestId: string, work: () => Promise<unknown>, via?: "call") {
  const host = getHost();
  const { cardAnswererFor, withDecisionActor } = host;
  const open = (() => {
    const card = host.store.messagesFor(threadId).find((message) => message.card?.requestId === requestId)?.card;
    return Boolean(card && !card.answered && !card.dismissed && !card.expired);
  })();
  try {
    await withDecisionActor(host.decisionActorFor(auth), work, via);
  } finally {
    const message = open ? host.store.messagesFor(threadId).find((candidate) => candidate.card?.requestId === requestId) : undefined;
    const card = message?.card;
    if (message && card && !card.answeredBy && card.answered !== "unavailable" && (card.answered || card.dismissed)) {
      // 2026-10-27: answered by a bot the person owns, from their own message
      // (sagax_approvals): the card reads "via <bot>". The field stays "primary-bot".
      const primary = host.actConfirmed()?.primary;
      // 2026-10-26: answered from the person's "Me joindre" channel (a text, Telegram, Teams)
      const reach = host.actConfirmed()?.reachMe;
      const how = primary ? { via: "primary-bot" as const, bot: primary.botName.slice(0, 80) } : reach ? { via: "reach-me" as const, channel: reach.channel } : via ? { via } : {};
      host.store.patchMessage(threadId, message.id, { card: { ...card, answeredBy: { ...cardAnswererFor(auth), ...how } } });
    }
  }

}
  return answeringCardAs;
}
