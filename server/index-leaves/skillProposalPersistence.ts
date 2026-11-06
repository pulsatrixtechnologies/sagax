// @ts-nocheck
/** skillProposalPersistence (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSkillProposalPersistence(getHost: () => Host): any {
function skillProposalPersistence(botId: string, threadId: string, opensCard = true) {
  const host = getHost();

  if (!host.store.bot(botId)) {
    return { ok: false as const, status: 403, error: "unknown sender" };
  }
  if (!host.connectorThread(botId, threadId)) {
    return { ok: false as const, status: 403, error: "source conversation does not belong to sender" };
  }
  if (!opensCard || host.fullAccessForSource(botId, threadId)) return { ok: true as const };
  const openRequests = host.store.activePath(threadId).filter(
    (message) =>
      message.card?.skillRequest?.botId === botId &&
      !message.card.answered &&
      !message.card.dismissed,
  ).length;
  return openRequests >= 8
    ? { ok: false as const, status: 429, error: "confirm or cancel an existing learned-skill card first" }
    : { ok: true as const };

}
  return skillProposalPersistence;
}
