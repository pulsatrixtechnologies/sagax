// @ts-nocheck
/** auditApprovalModeChange (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAuditApprovalModeChange(getHost: () => Host): any {
function auditApprovalModeChange(auth: RequestAuth | null, botId: string, before: ApprovalMode, after: ApprovalMode, threadId?: string) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction } = host;
  if (before === after) return;
  appendAdminAction(DATA_DIR, {
    category: "approval",
    action: "approval.mode",
    target: host.auditBotTarget(botId),
    changed: ["approvalMode"],
    before: { approvalMode: before },
    after: { approvalMode: after, ...(threadId ? { threadId } : {}) },
    actor: auth ? (host.IDENTITY.kind === "perspicax" ? host.orgAuditActor(auth) : host.decisionActorFor(auth)) : { kind: "loopback" }
  });

}
  return auditApprovalModeChange;
}
