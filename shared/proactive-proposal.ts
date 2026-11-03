// A proactive proposal card (2026-10-30, server/proactive/proactive-wake.ts): the bot
// offers to handle an event; options[0] accepts, options[1] declines. The
// answer goes to POST /api/bots/:id/proactive/:proposalId, never as a typed
// message. iOS mirrors this in CompanionCore (ProactiveProposalRules).

export interface ProactiveProposalCardLike {
  options: readonly string[];
  proactiveProposal?: { id: string };
}

/** Whether the picked option is the card's yes (its first option). */
export function proactiveProposalAccepts(card: ProactiveProposalCardLike, answer: string): boolean {
  const yes = card.options[0]?.trim();
  return Boolean(yes) && answer.trim() === yes;
}
