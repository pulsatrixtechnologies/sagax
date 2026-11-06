// @ts-nocheck
/** requestCwAction (#1388). Pure move from server/index.ts. */
import { ruleCandidateFor, scopeKeepable, WHOLE_CALL_KEY, wholeCallDigest } from "../approvals/owner-approval.ts";

export type Host = Record<string, any>;

export function createRequestCwAction(getHost: () => Host): any {
async function requestCwAction(auth: RequestAuth, threadId: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const host = getHost();
  const { DATA_DIR, appendDecision, channelViewerId } = host;
  const action = host.parseCwAction(body.action);
  if (!action) return { status: 400, body: { error: "action is not a ConnectWise change this widget can ask for" } };
  const group = host.store.groupByThread(threadId);
  let bot: BotRecord | undefined;
  if (group) {
    if (group.peopleDm) return { status: 404, body: { error: "no such conversation" } };
    if (host.IDENTITY.kind === "perspicax" && !host.groupPostAllowed(group, channelViewerId(auth))) {
      return { status: 403, body: { error: "you may read this channel, not post in it", code: "read_only" } };
    }
    const botId = typeof body.botId === "string" ? body.botId : "";
    if (!group.memberIds.includes(botId)) return { status: 400, body: { error: "botId must name a bot of this group" } };
    bot = host.store.bot(botId) ?? undefined;
  } else {
    const owner = host.store.botByThread(threadId);
    if (!owner) return { status: 404, body: { error: "no such conversation" } };
    try {
      host.routeThreadId(owner, threadId, "thread.post");
    } catch (error) {
      const status = (error as { status?: number }).status ?? 403;
      return { status, body: { error: status === 404 ? "no such conversation" : "you may not post in this conversation" } };
    }
    bot = host.botForThread(owner.id, threadId) ?? owner;
  }
  if (!bot) return { status: 404, body: { error: "no such bot" } };
  const audience = approvalAudience({ ownerUserId: host.approvalOwnerId(bot, threadId), host: host.approvalHostOf(bot) });
  if (!host.cwActionActor(auth) || approvalAnswerStatus({ question: false, audience, callerUserId: host.approvalCallerUserId(auth) }) === 403) {
    return { status: 403, body: { error: "Only the bot owner can approve a ConnectWise change.", code: "cw_action_owner_only" } };
  }
  const personal = host.languageOfRequest(auth);
  const language = cwActionLanguage(personal);
  const card = cwActionCard(action, language, host.actorPrincipalId(auth));
  const cwProduct = host.declaredToolProduct(bot.id, "cw_psa_write");
  const plain = approvalPlain({ botName: bot.name, tool: "cw_psa_write", toolInput: card.toolInput, detail: card.summary, ...(cwProduct ? { hints: cwProduct } : {}) }, host.serverApprovalWords(personal));
  // 2026-10-19 ("Toujours permettre" on every card): what Always allow
  // keeps here (this bot, this kind of ConnectWise change), and whether the
  // person already kept it (no security key of theirs protecting the write)
  const described = ruleCandidateFor({ tool: "cw_psa_write", input: card.toolInput }, host.serverApprovalWords(personal));
  // #2091 (decided 2026-11-05): a scope too long to keep exactly keeps the whole
  // request (its digest), like every other card; never a card without Always
  const candidate = scopeKeepable(described.scope)
    ? { ...described, tool: host.CW_WIDGET_RULE_TOOL }
    : { ...described, tool: host.CW_WIDGET_RULE_TOOL, scope: { [WHOLE_CALL_KEY]: wholeCallDigest(card.toolInput) } };
  const answerer = host.approvalOwnerId(bot, threadId);
  const stepUp = host.autoAnswerStepUp(bot, threadId, { tool: "cw_psa_write", input: card.toolInput, summary: card.summary });
  // 2026-10-20 (security review): the answerer's rule answers only the
  // answerer's own request, never another member's in a group channel
  const ownRequest = Boolean(answerer) && host.actorPrincipalId(auth).trim().toLowerCase() === answerer.trim().toLowerCase();
  const kept = ownRequest && !stepUp.length
    ? host.cwWidgetRule(host.ownerApprovals.rulesOf(answerer, bot.id).filter((rule) => rule.botId === bot.id), answerer, bot.id, card.toolInput)
    : undefined;
  // the ConnectWise widget's own approval card; its write is then answered
  // in request.opened (widgetApproved); full-access: send
  const message = host.store.appendMessage(threadId, {
    role: "bot",
    kind: "options",
    from: { botId: bot.id, name: bot.name, color: bot.color },
    card: {
      title: "Approval needed",
      subtitle: card.summary,
      options: ["Allow", "Deny"],
      requestId: card.requestId,
      // full-access: send
      requestType: "permission",
      tool: "cw_psa_write",
      toolInput: card.toolInput,
      ...(plain ? { plain } : {}),
      cwActionRequest: card.cwActionRequest,
      ownerRule: candidate
    }
  });
  if (kept?.behavior === "allow") {
    const actor = host.cwActionActor(auth)!;
    appendDecision(DATA_DIR, {
      threadId, requestId: card.requestId, botId: bot.id, botName: bot.name, tool: "cw_psa_write", summary: card.summary,
      decision: "auto-approved", source: "owner-rule", rule: kept.id
    });
    const done = await host.allowCwAction(actor, threadId, message.id, { ...message.card!, ruleSaved: { id: kept.id, behavior: kept.behavior, description: kept.description } }, bot, action, host.languageOfRequest(auth));
    return done.status < 400
      ? { status: 201, body: { requestId: card.requestId, messageId: message.id, allowedByRule: true } }
      : done;
  }
  if (kept?.behavior === "deny") {
    host.store.patchMessage(threadId, message.id, { card: { ...message.card!, answered: "deny" } });
    return { status: 201, body: { requestId: card.requestId, messageId: message.id, deniedByRule: true } };
  }
  return { status: 201, body: { requestId: card.requestId, messageId: message.id } };

}
  return requestCwAction;
}
