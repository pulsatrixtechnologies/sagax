// @ts-nocheck
/** resolveAndSendRule (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveAndSendRule(getHost: () => Host): any {
function resolveAndSendRule(   res: ServerResponse,   args: { botId: string; botName?: string; threadId: string; requestId: string; behavior: string; personId?: string }, ) {
  const host = getHost();
  const { DATA_DIR, appendDecision, json } = host;
  const card = host.store.messagesFor(args.threadId).find(
    (message) => message.card?.requestId === args.requestId && message.card.ruleRequest,
  )?.card;
  if (!card) return false;
  const result = host.ruleRequests.resolve(args);
  if (!result.claimed) return false;
  if (result.state === "applied" || result.state === "denied") {
    appendDecision(DATA_DIR, {
      threadId: args.threadId, requestId: args.requestId, botId: args.botId, botName: args.botName,
      tool: "propose_rule", summary: card.subtitle,
      decision: result.state === "applied" ? "user-approved" : "user-denied", source: "user"
    });
  }
  if (result.state === "applied") {
    json(res, 200, {
      ok: true, outcome: "allowed-once", ruleId: result.ruleId, ruleAction: result.action,
      ...(result.settlementPending ? { settlementPending: true, message: result.message } : {})
    });
    return true;
  }
  if (result.state === "invalid") { json(res, result.status, { error: result.error, ...(result.code ? { code: result.code } : {}) }); return true; }
  if (result.state === "already_settled") {
    json(res, 200, { ok: true, outcome: result.behavior === "allow" ? "allowed-once" : "rejected", alreadySettled: true });
    return true;
  }
  json(res, 200, { ok: true, outcome: "rejected" });
  return true;

}
  return resolveAndSendRule;
}
