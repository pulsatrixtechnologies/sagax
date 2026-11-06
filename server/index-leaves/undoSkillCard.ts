// @ts-nocheck
/** undoSkillCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUndoSkillCard(getHost: () => Host): any {
function undoSkillCard(botId: string, threadId: string, messageId: string) {
  const host = getHost();

  const message = host.store.messagesFor(threadId).find((candidate) => candidate.id === messageId);
  const card = message?.card;
  const request = card?.skillRequest;
  if (!message || !card || !request) return { claimed: false };
  if (card.undone) return { claimed: true, state: "already_undone" };
  if (!card.autoApplied || card.answered !== "allow") {
    return { claimed: true, state: "invalid", error: "Only a change that applied on its own can be undone here.", status: 409 };
  }
  if (request.botId !== botId || request.threadId !== threadId) {
    return { claimed: true, state: "invalid", error: "this skill request belongs to a different bot", status: 403 };
  }
  const undone = undoSkillWrite(botId, {
    stagedId: request.stagedId,
    name: request.name,
    action: request.action,
    ...(request.previous ? { previous: { skillMd: request.previous.preview, source: request.previous.source } } : {})
  });
  if ("stale" in undone) return { claimed: true, state: "invalid", error: host.UNDO_STALE, status: 409, stale: true };
  if ("error" in undone) return { claimed: true, state: "invalid", error: undone.error, status: 409 };
  host.store.patchMessage(threadId, message.id, { card: { ...card, undone: true } });
  return { claimed: true, state: "undone" };

}
  return undoSkillCard;
}
