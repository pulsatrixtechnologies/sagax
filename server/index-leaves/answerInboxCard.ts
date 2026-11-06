// @ts-nocheck
/** answerInboxCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAnswerInboxCard(getHost: () => Host): any {
async function answerInboxCard(auth: RequestAuth, threadId: string, requestId: string, decision: "allow" | "deny", rule?: "allow") {
  const host = getHost();
  const { inboxSpecialCard } = host;

  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  const card = message?.card;
  if (!message || !card || !host.isApprovalCardMessage(message)) return { ok: false, status: 404, code: "gone", message: "No such approval." };
  if (card.answered || card.dismissed || card.expired) return { ok: false, status: 409, code: "gone", message: "This approval was already answered or has expired." };
  // 2026-10-19: a bulk Always allow keeps each card's own rule (its exact
  // scope); a card with none, or an admin's, is answered on its own card
  if (rule && (decision !== "allow" || !card.ownerRule)) return { ok: false, status: 409, code: "no-rule", message: "This approval cannot be remembered in a bulk answer." };
  // a bulk answer carries no key: an Always allow the person protects with
  // one (always-grant) is refused here, like an Allow that needs one
  if (host.stepUpGate(host.ruleManager(auth), threadId, requestId, decision, rule ? { always: false, rememberCommand: false, rule } : {}, undefined)) return { ok: false, status: 403, code: "needs-key", message: "This approval needs your security key." };
  // the guards POST /api/threads/:id/respond meets on its way in: an
  // archived temporary agent takes no answer, and the person must be able to
  // post on the thread (an admin's card excepted, as adminAnswersPendingApproval)
  const cardBot = host.botForApproval(threadId, message);
  if (!cardBot) return { ok: false, status: 404, code: "gone", message: "No such approval." };
  if (cardBot.temporary?.archived) return { ok: false, status: 410, code: "gone", message: "This agent was archived." };
  const posterId = host.channelFilterViewerId(auth);
  if (!card.adminApproval && posterId && !host.botThreadReadable(cardBot, threadId, posterId, "thread.post")) return { ok: false, status: 403, code: "not-yours", message: "You cannot answer on this conversation." };
  if (host.delegatedRequest() && host.store.isConfidentialThread(threadId)) return { ok: false, status: 403, code: "confidential", message: host.CONFIDENTIAL_CARD_DELEGATED };
  if (inboxSpecialCard(card) || host.isConfidentialMemoryCard(threadId, requestId) || host.isBotActCard(threadId, requestId)) return { ok: false, status: 400, code: "special", message: "Answer this one on its own card." };
  const adminCheck = host.adminApprovalCheck(auth, threadId, requestId);
  if (adminCheck === "refused") return { ok: false, status: 403, code: "not-yours", message: host.ADMIN_APPROVAL_REQUIRED.error };
  const ownerRefusal = adminCheck ? null : host.approvalAnswerRefusal(auth, threadId, requestId);
  if (ownerRefusal) return { ok: false, status: 403, code: "not-yours", message: ownerRefusal };
  const refusal = host.cardAnswerRefusal(auth, threadId, requestId, decision);
  if (refusal) return { ok: false, status: 403, code: "not-yours", message: refusal };
  if (rule) {
    const ruleRefusal = host.saveOwnerRuleFromCard(auth, threadId, requestId, rule, decision);
    if (ruleRefusal) return { ok: false, status: ruleRefusal.status, code: "no-rule", message: ruleRefusal.error };
  }
  let answer: InboxAnswer = { ok: true };
  await host.answeringCardAs(auth, threadId, requestId, async () => {
    // a safety hold (server/safety/safety-review.ts) is settled where it waits
    if (settleSafetyHold(requestId, decision)) {
      const held = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
      if (held?.card && !held.card.answered) host.store.patchMessage(threadId, held.id, { card: { ...held.card, answered: decision } });
      return;
    }
    if (resolvePeerComms(host.approvalBus, requestId, decision)) return;
    const group = host.store.groupByThread(threadId);
    const owner = group
      ? (group.busyBotId ? host.store.bot(group.busyBotId) : undefined) ?? (message.from ? host.store.bot(message.from.botId) : undefined)
      : host.store.botByThread(threadId);
    const requestOwner = owner ? host.botForThread(owner.id, threadId) : null;
    const outcome = await host.answerRequest(threadId, requestOwner?.modelSelection.instanceId ?? "", requestId, decision,
      decision === "deny" ? "Denied by the user." : undefined, owner ? { id: owner.id, name: owner.name } : undefined, false, false);
    // nothing ran: never counted as answered
    if (outcome === "unavailable") answer = { ok: false, status: 409, code: "gone", message: "The request is no longer open." };
  });
  return answer;

}
  return answerInboxCard;
}
