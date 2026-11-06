// @ts-nocheck
/** resolveAndSendTrust (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveAndSendTrust(getHost: () => Host): any {
function resolveAndSendTrust(res: ServerResponse, threadId: string, requestId: string, behavior: "allow" | "deny" | "answer") {
  const host = getHost();
  const { DATA_DIR, appendDecision, json } = host;
  if ((behavior === "allow" || behavior === "deny") && settleSafetyHold(requestId, behavior)) {
    const safetyCard = host.store.messagesFor(threadId).find((message) => message.card?.requestId === requestId);
    if (safetyCard?.card && !safetyCard.card.answered) {
      host.store.patchMessage(threadId, safetyCard.id, { card: { ...safetyCard.card, answered: behavior } });
    }
    json(res, 200, { ok: true, outcome: behavior === "allow" ? "allowed-once" : "rejected" });
    return true;
  }
  const teamMemoryCard = host.store.messagesFor(threadId).find(
    (message) => message.card?.requestId === requestId && message.card.teamMemoryRequest,
  );
  if (teamMemoryCard?.card?.teamMemoryRequest) {
    const request = teamMemoryCard.card.teamMemoryRequest;
    const proposer = teamMemoryCard.from?.botId ? host.store.bot(teamMemoryCard.from.botId) : host.store.botByThread(threadId);
    // settled already (on this card, on another, or on the team-memory
    // page): the real outcome, never a fresh "allowed"
    if (host.teamMemoryCardSettled(teamMemoryCard.card)) {
      const late = host.teamMemoryLateAnswer(teamMemoryCard.card);
      json(res, late.status, late.body);
      return true;
    }
    const memoryKey = host.teamStorageKeyFor(request.section, proposer ? host.effectiveBotOwner(proposer) : undefined);
    const result = host.teamMemory.resolve(memoryKey, request.entryId, behavior === "allow" ? "accept" : "reject");
    if (!result.claimed || result.state === "already_settled") {
      // the entry was deleted, or accepted, before this card heard of it:
      // close the card (no answerer to name) and say so
      host.store.patchMessage(threadId, teamMemoryCard.id, { card: { ...teamMemoryCard.card, answered: "unavailable", dismissed: true } });
      const late = host.teamMemoryLateAnswer({ answered: result.claimed ? "allow" : "deny" });
      json(res, late.status, late.body);
      return true;
    }
    host.store.patchMessage(threadId, teamMemoryCard.id, {
      card: { ...teamMemoryCard.card, answered: result.state === "accepted" ? "allow" : "deny" }
    });
    appendDecision(DATA_DIR, {
      threadId, requestId, botId: proposer?.id, botName: proposer?.name,
      tool: "propose_team_memory", summary: teamMemoryCard.card.subtitle,
      decision: result.state === "accepted" ? "user-approved" : "user-denied", source: "user"
    });
    json(res, 200, { ok: true, outcome: result.state === "accepted" ? "allowed-once" : "rejected" });
    return true;
  }
  const outboundCard = host.store.messagesFor(threadId).find(
    (message) => message.card?.requestId === requestId && message.card.outboundRequest,
  );
  if (outboundCard?.card?.outboundRequest) {
    const outboundBot = outboundCard.from?.botId ? host.store.bot(outboundCard.from.botId) : host.store.botByThread(threadId);
    const result = host.outboundRequests.resolve({ threadId, requestId, behavior });
    if (!result.claimed) {
      // The hold is memory-only: after a restart the card outlives the
      // relay that was waiting on it, so close it rather than leave an
      // approval nobody can deliver owning the composer.
      if (!outboundCard.card.answered) {
        host.store.patchMessage(threadId, outboundCard.id, { card: { ...outboundCard.card, answered: "unavailable", dismissed: true } });
      }
      json(res, 200, { ok: true, outcome: "unavailable" });
      return true;
    }
    if (result.state === "already_settled") {
      json(res, 200, { ok: true, outcome: result.behavior === "allow" ? "allowed-once" : "rejected", alreadySettled: true });
      return true;
    }
    host.store.patchMessage(threadId, outboundCard.id, {
      card: { ...outboundCard.card, answered: result.state === "allowed" ? "allow" : "deny" }
    });
    appendDecision(DATA_DIR, {
      threadId, requestId, botId: outboundBot?.id, botName: outboundBot?.name,
      tool: outboundCard.card.tool, summary: outboundCard.card.subtitle,
      decision: result.state === "allowed" ? "user-approved" : "user-denied", source: "user"
    });
    json(res, 200, { ok: true, outcome: result.state === "allowed" ? "allowed-once" : "rejected" });
    return true;
  }
  return false;

}
  return resolveAndSendTrust;
}
