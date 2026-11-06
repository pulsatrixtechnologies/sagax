// @ts-nocheck
/** auditFullAccessTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAuditFullAccessTurn(getHost: () => Host): any {
function auditFullAccessTurn(bot: BotRecord, threadId: string, mode: ApprovalMode) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction } = host;
  if (mode === "full") {
    appendAdminAction(DATA_DIR, {
      category: "approval",
      action: "approval.full_access_turn",
      target: host.auditBotTarget(bot.id),
      after: { threadId, ...(host.IDENTITY.kind === "perspicax" ? { owner: host.effectiveBotOwner(bot) } : {}) },
      actor: { kind: "worker" }
    });
  }
  return mode;

}
  return auditFullAccessTurn;
}
