// @ts-nocheck
/** answeringCardAs (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

/** The card's `answeredBy`: who answered, and how. #4219: also written by
 * the sequenced delivery of a keyed room card's answer
 * (deliverLateQuestionAnswer.ts), named with who answered; this one then
 * keeps it. */
export function cardAnsweredBy(host: Host, auth: RequestAuth, via?: "call") {
  // 2026-10-27: answered by a bot the person owns, from their own message
  // (sagax_approvals): the card reads "via <bot>". The field stays "primary-bot".
  const primary = host.actConfirmed()?.primary;
  // 2026-10-26: answered from the person's "Me joindre" channel (a text, Telegram, Teams)
  const reach = host.actConfirmed()?.reachMe;
  const how = primary ? { via: "primary-bot" as const, bot: primary.botName.slice(0, 80) } : reach ? { via: "reach-me" as const, channel: reach.channel } : via ? { via } : {};
  return { ...host.cardAnswererFor(auth), ...how };
}

export function createAnsweringCardAs(getHost: () => Host): any {
async function answeringCardAs(auth: RequestAuth, threadId: string, requestId: string, work: () => Promise<unknown>, via?: "call") {
  const host = getHost();
  const { withDecisionActor } = host;
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
      host.store.patchMessage(threadId, message.id, { card: { ...card, answeredBy: cardAnsweredBy(host, auth, via) } });
    }
    // #3671: the answer's decision row is queued (server/decision-log.ts);
    // both answer routes (a card, the Approvals screen's bulk answer) return
    // once it is on disk, so the history read right after lists this card.
    // The flush never throws: a full disk still answers the card.
    await host.flushDecisionLog(host.DATA_DIR);
  }

}
  return answeringCardAs;
}
