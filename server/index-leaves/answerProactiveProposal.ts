// @ts-nocheck
/** answerProactiveProposal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAnswerProactiveProposal(getHost: () => Host): any {
function answerProactiveProposal(botId: string, proposalId: string, accept: boolean): { status: number; body: Record<string, unknown> } {
  const host = getHost();

  const bot = host.store.bot(botId);
  const open = bot ? host.proactiveProposals.get(proposalId) : null;
  if (!bot || !open || open.botId !== bot.id) return { status: 404, body: { error: "no such proposal" } };
  // the caller must be able to write in that conversation
  try {
    host.routeThreadId(bot, open.threadId);
  } catch {
    return { status: 404, body: { error: "no such proposal" } };
  }
  // 2026-11-01: the wake starts before the yes is kept; a wake that cannot
  // start leaves the proposal open (it used to be answered and do nothing).
  let proposal: ReturnType<typeof host.proactiveProposals.answer>;
  try {
    proposal = host.proactiveProposals.answer(proposalId, accept ? "accepted" : "declined", accept ? () => host.startProactiveWake({
      botId: bot.id, mode: host.proactiveModeFor(bot), events: open.events, more: open.more, hops: open.hops,
      confined: open.confined, reasons: []
    }, true) : undefined);
  } catch (error) {
    return { status: 503, body: { error: `The work could not start: ${error instanceof Error ? error.message : String(error)}. The proposal stays open; answer it again.` } };
  }
  if (!proposal) return { status: 409, body: { error: "this proposal was already answered" } };
  const message = host.store.messagesFor(proposal.threadId).find((row) => row.id === proposal.messageId);
  if (message?.card) {
    const picked = (accept ? message.card.options[0] : message.card.options[1]) ?? (accept ? "accept" : "decline");
    host.store.patchMessage(proposal.threadId, message.id, { card: { ...message.card, answered: picked, answeredText: picked } });
  }
  return { status: 200, body: { ok: true, accepted: accept } };

}
  return answerProactiveProposal;
}
