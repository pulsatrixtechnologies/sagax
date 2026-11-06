// @ts-nocheck
/** answerCardFromConsole (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAnswerCardFromConsole(getHost: () => Host): any {
/** Slice 7: answer a plain tool card from the Perspicax console, once,
 * allow or deny, with the same refusals as Sagax: the owner for an owner
 * card, an organization admin for an admin card, and only on the fleet
 * host. #2100: `rule: "allow"` keeps that card's own Always allow, like
 * bulk Approvals (never a session allow or a remembered command). */
async function answerCardFromConsole(viewer: OrgAdminViewer, threadId: string, requestId: string, decision: "allow" | "deny", rule?: "allow"): Promise<ApprovalAnswer> {
  const host = getHost();
  const { withDecisionActor } = host;

  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  const card = message?.card;
  if (!message || !card || !host.isApprovalCardMessage(message)) return { ok: false, status: 404, code: "not_found", message: "No such approval." };
  const bot = host.botForApproval(threadId, message);
  if (!bot) return { ok: false, status: 404, code: "not_found", message: "No such approval." };
  if (card.answered || card.dismissed || card.expired) return { ok: false, status: 409, code: "card_not_pending", message: "This approval was already answered or has expired." };
  const kind = card.adminApproval ? "admin" : "owner";
  if (host.store.isConfidentialThread(threadId) && kind === "admin") return { ok: false, status: 404, code: "not_found", message: "No such approval." };
  if (kind === "admin" ? !viewer.orgAdmin : host.cardAnswererId(bot, threadId, card) !== viewer.principalId) {
    return { ok: false, status: 403, code: "forbidden", message: kind === "admin" ? "Only an organization admin can answer this approval." : "Only the bot owner can answer this approval." };
  }
  if (host.approvalTypeOf(card) !== "tool" || host.approvalHostOf(bot).kind !== "fleet") {
    return { ok: false, status: 403, code: "not_decidable", message: "Open this approval in Sagax to answer it." };
  }
  // The console carries no security key: a card that needs one is answered in Sagax.
  // Always allow widens the grant: org Always allow off answers 403
  // org_always_allow_off (same as bulk Approvals / a card in Sagax).
  const widen = rule ? { always: false, rememberCommand: false, rule } : {};
  const gated = host.stepUpGate(viewer.principalId, threadId, requestId, decision, widen, undefined);
  if (gated) {
    const code = typeof gated.body === "object" && gated.body && "code" in gated.body ? String((gated.body as { code?: unknown }).code ?? "") : "";
    if (code === "org_always_allow_off") {
      return { ok: false, status: 403, code: "org_always_allow_off", message: host.ORG_ALWAYS_ALLOW_OFF.error };
    }
    return { ok: false, status: 403, code: "not_decidable", message: "This approval needs a security key. Open it in Sagax to answer it." };
  }
  if (rule) {
    const ruleRefusal = host.saveOwnerRuleFromCard(host.consoleRuleAuth(viewer), threadId, requestId, rule, decision);
    if (ruleRefusal) {
      const status = ruleRefusal.status === 400 || ruleRefusal.status === 403 || ruleRefusal.status === 404 || ruleRefusal.status === 409
        ? ruleRefusal.status
        : 403;
      const code = status === 404 ? "not_found" as const
        : status === 409 ? "card_not_pending" as const
        : status === 403 ? "forbidden" as const
        : "bad_request" as const;
      return { ok: false, status, code, message: ruleRefusal.error };
    }
  }
  const answerer = `${viewer.name} (console)`;
  const actor: DecisionActor = { kind: "session", sessionId: "console", label: answerer, userId: viewer.principalId };
  const group = host.store.groupByThread(threadId);
  const owner = group
    ? (group.busyBotId ? host.store.bot(group.busyBotId) : undefined) ?? (message.from ? host.store.bot(message.from.botId) : undefined)
    : host.store.botByThread(threadId);
  const requestOwner = owner ? host.botForThread(owner.id, threadId) : null;
  await withDecisionActor(actor, () => host.answerRequest(threadId, requestOwner?.modelSelection.instanceId ?? "", requestId, decision, undefined, owner ? { id: owner.id, name: owner.name } : undefined, false, false));
  const settled = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  if (settled?.card && !settled.card.answeredBy && settled.card.answered !== "unavailable" && (settled.card.answered || settled.card.dismissed)) {
    host.store.patchMessage(threadId, settled.id, { card: { ...settled.card, answeredBy: { kind: "session", name: answerer } } });
  }
  host.orgAudit({
    category: "approval", action: "approval.answer", target: host.auditBotTarget(bot.id),
    after: { decision, threadId, requestId, kind, ...(rule ? { rule } : {}) },
    actor: { kind: "person", principalId: viewer.principalId, via: "console" }
  });
  return { ok: true };

}
  return answerCardFromConsole;
}
