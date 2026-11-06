// @ts-nocheck
/** undoAppliedChange (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUndoAppliedChange(getHost: () => Host): any {
function undoAppliedChange(res: ServerResponse, threadId: string, requestId: string) {
  const host = getHost();
  const { DATA_DIR, appendDecision, json } = host;
  const message = host.store.messagesFor(threadId).find((candidate) => candidate.card?.requestId === requestId);
  const card = message?.card;
  if (!message || !card) return json(res, 404, { error: "this change is no longer in the conversation" });
  // The proposing bot comes from the conversation (a room card's trusted
  // sender, else the thread's bot), never from the card payload.
  const botId = message.from?.botId ?? host.store.botByThread(threadId)?.id;
  if (!botId) return json(res, 400, { error: "this change has no valid owner" });
  let result: UndoResult = { claimed: false };
  if (card.routineRequest) {
    const undone = host.routineRequests.undo({ botId, threadId, requestId });
    // On a Cloud home a routine Undo removed is forgotten, and one it put
    // back is the owner's only if it was theirs before the change.
    if (undone.claimed && undone.state === "undone") {
      // Personal Cloud routine authorship tracking is gone.
    }
    result = undone;
  } else if (card.profileRequest) {
    const undone = host.profileRequests.undo({ botId, threadId, requestId });
    if (undone.claimed && undone.state === "undone") {
      const target = host.store.bot(undone.targetBotId);
      if (target) host.broadcast({ kind: "bot", bot: host.wireBot(target) });
    }
    result = undone;
  } else if (card.modelRequest) {
    const undone = host.modelRequests.undo({ botId, threadId, requestId });
    if (undone.claimed && undone.state === "undone") {
      const target = host.store.bot(undone.targetBotId);
      if (target) host.broadcast({ kind: "bot", bot: host.wireBot(target) });
    }
    result = undone;
  } else if (card.skillRequest) {
    result = host.undoSkillCard(botId, threadId, message.id);
  } else if (card.waitRequest) {
    result = card.undone
      ? { claimed: true, state: "already_undone" }
      : host.cancelWaitFromCard(host.botWaits, host.store, { botId, threadId, messageId: message.id, waitId: card.waitRequest.waitId })
        ? { claimed: true, state: "undone" }
        : { claimed: true, state: "invalid", error: "This wait has already ended.", status: 409 };
  }
  if (!result.claimed) return json(res, 409, { error: "Only a change that applied on its own can be undone here." });
  if (result.state === "invalid") {
    return json(res, result.status, { error: result.error, ...(result.stale ? { code: "changed-since" } : {}) });
  }
  if (result.state === "undone") {
    appendDecision(DATA_DIR, {
      threadId, requestId, botId, botName: host.store.bot(botId)?.name,
      tool: card.tool, summary: card.subtitle, decision: "user-undone", source: "user"
    });
  }
  json(res, 200, { ok: true, undone: true, ...(result.state === "already_undone" ? { alreadyUndone: true } : {}) });

}
  return undoAppliedChange;
}
