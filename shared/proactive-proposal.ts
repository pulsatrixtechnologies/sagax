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

/** The body of the card's answer route: a choice card's yes carries its
 * switches (#3457, the watches kept on), so a watch the person turned off
 * in the details is not turned on by the yes. */
export function proactiveProposalBody(card: ProactiveProposalCardLike, answer: string, watchesOn?: readonly string[]): { accept: boolean; watches?: string[] } {
  const accept = proactiveProposalAccepts(card, answer);
  return accept && watchesOn ? { accept, watches: [...watchesOn] } : { accept };
}
