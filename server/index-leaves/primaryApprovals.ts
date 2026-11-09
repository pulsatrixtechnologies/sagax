// @ts-nocheck
/** primaryApprovals (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createIndexPrimaryApprovals(getHost: () => Host): any {
function primaryApprovals() {
  const host = getHost();
  const { isPrincipalId, outbound } = host;
  const actorOf = (turn: PrimaryTurn) => (turn as PrimaryTurn & { actor: PerformActor }).actor;
  const replay = async (turn: PrimaryTurn, method: string, path: string, body?: Record<string, unknown>, cardThread?: string) => {
    const actor = actorOf(turn);
    const confirmed = { personKey: actor.kind === "person" ? actor.personKey : null, classes: [] as string[], primary: { botId: turn.botId, botName: turn.botName, messageId: turn.message.id } satisfies PrimaryAnswer };
    const target = { kind: "route" as const, method, path, ...(body ? { body } : {}) };
    // 2026-10-20 a card of the person's own confidential thread. The
    // replay carries a one-shot token for exactly this request on exactly
    // that thread, so it is the owner's own answer there (an on-behalf
    // request never reaches a confidential thread); the answer's text is
    // never relayed to the Primary Bot.
    const answer = cardThread && host.store.isConfidentialThread(cardThread)
      ? await host.performBotActRoute(actor, target, 8000, { onBehalf: true, continuation: cardThread, continuationExact: true, confirmed })
      : await host.performBotActRouteOutsideConfidential(actor, target, confirmed);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(answer.text) as Record<string, unknown>; } catch { parsed = { error: answer.text.slice(0, 300) }; }
    return { status: answer.status, body: answer.status >= 400 ? { error: String(parsed.error ?? "The answer was refused."), ...(parsed.code ? { code: parsed.code } : {}) } : parsed };
  };
  host.primaryApprovalService ??= host.createPrimaryApprovals({
    turn: host.primaryTurnGate,
    pending: (turn) => {
      const auth = host.primaryListAuth(actorOf(turn));
      if (!auth) return [];
      const out: PrimaryCard[] = [];
      for (const item of host.inboxPending(auth, { principalId: turn.person })) {
        if (!host.primaryAnswerable(item)) continue;
        const message = host.store.messagesFor(item.threadId).find((row) => row.card?.requestId === item.requestId);
        const card = message?.card;
        if (!message || !card || card.answered || card.dismissed || card.expired) continue;
        const durable = Boolean(card.routineRequest || card.skillRequest || card.profileRequest || card.teamSetupRequest || card.modelRequest);
        const options: PrimaryDecision[] = item.kind === "question" ? ["answer"] : ["allow", "deny"];
        let always: PrimaryCard["always"];
        if (item.kind !== "question") {
          if (card.ownerRule) always = "rule";
          else if (card.allowSession && !card.allowKey) always = "session";
          if (always) options.push("always_allow");
          if (card.customRuleCandidate && !card.adminApproval && !durable && item.needsKey !== true) options.push("always_allow_this");
          if (card.ownerRule && host.alwaysDenyOffered(card)) options.push("always_deny");
        }
        const openedBy = host.store.taskByThread(item.botId, item.threadId)?.openedBy;
        out.push({
          threadId: item.threadId, requestId: item.requestId, botId: item.botId, botName: item.botName, at: item.at,
          title: String(card.plain?.title ?? card.title ?? "Approval").slice(0, 200),
          line: String(card.plain?.line ?? card.subtitle ?? "").replace(/\s+/g, " ").slice(0, 240),
          ...(item.roomName ?? item.threadTitle ? { where: String(item.roomName ?? item.threadTitle) } : {}),
          ...(openedBy?.name ? { askedBy: openedBy.name } : {}),
          kind: item.kind === "question" ? "question" : item.kind === "proposal" ? "proposal" : "permission",
          needsKey: item.needsKey === true,
          ...(host.store.isConfidentialThread(item.threadId) ? { confidential: true } : {}),
          options,
          ...(always ? { always } : {}),
          ...(card.ownerRule?.description ? { alwaysScope: card.ownerRule.description } : {})
        });
      }
      const vaultPerson = host.IDENTITY.kind === "perspicax" ? turn.person.toLowerCase() : host.LOCAL_VAULT_PRINCIPAL;
      // a phone call: Call this once, Always call this number, or Do not
      // call, like the person on the card (the maintainer 2026-11-06)
      out.push(...outbound.primaryPending(vaultPerson, host.securityKeys.required(vaultPerson, ["money"]).length > 0));
      // a purchase: allow this once, always on this site (#2091), or deny
      for (const purchase of host.credentialVault.pendingPurchases(vaultPerson)) {
        out.push(host.primaryPurchaseCard(purchase, host.store.bot(purchase.botId)?.name || "Bot", host.securityKeys.required(vaultPerson, ["money"]).length > 0));
      }
      return out;
    },
    // #3221: the rest of the Today box (needs-you cards, proactive offers),
    // so one sagax_approvals list answers "what is in my Today box"
    waiting: (turn) => {
      const auth = host.primaryListAuth(actorOf(turn));
      if (!auth) return [];
      const out = [];
      for (const item of host.inboxPending(auth, { principalId: turn.person })) {
        const attention = item.kind === "attention";
        if (!attention && !item.proactiveId) continue;
        if (host.store.isConfidentialThread(item.threadId)) continue;
        const message = host.store.messagesFor(item.threadId).find((row) => row.id === item.messageId);
        const text = attention
          ? (message?.attention?.items ?? []).map((entry) => String(entry?.text ?? "")).filter(Boolean).join("; ")
          : String(message?.card?.plain?.title ?? message?.card?.title ?? message?.text ?? "");
        out.push({
          botName: item.botName, kind: attention ? "needs-you" : "offer", at: item.at,
          text: text.replace(/\s+/g, " ").slice(0, 240) || (attention ? "needs the person" : "an offer"),
          ...(item.routineName ?? item.threadTitle ? { where: String(item.routineName ?? item.threadTitle) } : {})
        });
      }
      return out;
    },
    respond: (turn, card, body) => {
      if (card.requestId.startsWith("call_") || card.requestId.startsWith("pay_")) {
        const call = card.requestId.startsWith("call_");
        // a call: the number the Primary Bot confirms is the card's own
        const number = call ? outbound.calls.get(card.requestId)?.request.to : undefined;
        const answer = host.primaryOutboundDecision(call ? "call" : "purchase", body, number);
        if ("refused" in answer) return Promise.resolve({ status: 400, body: { error: answer.refused, code: "card_only" } });
        const route = call ? `/api/me/phone-calls/${card.requestId}/answer` : `/api/me/credentials/purchases/${card.requestId}/answer`;
        return replay(turn, "POST", route, answer, card.threadId);
      }
      const message = host.store.messagesFor(card.threadId).find((row) => row.card?.requestId === card.requestId);
      const skill = message?.card?.skillRequest && body.behavior === "allow" ? host.reviewedSkillSha256(message.card.skillRequest) : undefined;
      return replay(turn, "POST", `/api/threads/${card.threadId}/respond`, { requestId: card.requestId, ...body, ...(skill ? { reviewedSha256: skill } : {}) }, card.threadId);
    },
    customRule: (turn, card) => {
      const message = host.store.messagesFor(card.threadId).find((row) => row.card?.requestId === card.requestId);
      const candidate = message?.card?.customRuleCandidate;
      if (!candidate) return Promise.resolve({ status: 409, body: { error: "This card offers no Always allow this." } });
      return replay(turn, "POST", "/api/custom-rules", { when: candidate.when, behavior: "allow", botId: card.botId, riskScope: [], fromCard: { threadId: card.threadId, requestId: card.requestId } }, card.threadId);
    },
    dropCustomRule: (turn, ruleId) => replay(turn, "DELETE", `/api/custom-rules/${encodeURIComponent(ruleId)}`),
    cancel: (turn, card) => {
      const group = host.store.groupByThread(card.threadId);
      return group
        ? replay(turn, "POST", `/api/groups/${group.id}/interrupt`, { threadId: card.threadId }, card.threadId)
        : replay(turn, "POST", `/api/bots/${card.botId}/interrupt`, { threadId: card.threadId }, card.threadId);
    },
    audit: (turn, card, decision) => {
      host.appendAdminAction(host.DATA_DIR, {
        category: "approval",
        action: "approval.answer",
        target: host.auditBotTarget(card.botId),
        // "approved by <bot> on behalf of <person>, message <id>"
        after: { decision, threadId: card.threadId, requestId: card.requestId, via: "primary-bot", bot: turn.botId, botName: turn.botName, message: turn.message.id },
        actor: host.IDENTITY.kind === "perspicax" && isPrincipalId(turn.person) ? { kind: "person", principalId: turn.person, via: "sagax" } : { kind: "loopback" }
      });
    }
  });
  return host.primaryApprovalService;

}
  return primaryApprovals;
}
