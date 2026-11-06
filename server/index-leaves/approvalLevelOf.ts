// @ts-nocheck
/** approvalLevelOf (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createApprovalLevelOf(getHost: () => Host): any {
function approvalLevelOf(botId: string, threadId?: string): { setting: ApprovalMode; applied?: AppliedApprovalLevel } | null {
  const host = getHost();
  const { approvalModeFor, memberAutoApprovalAllowed, memberTurnLevel } = host;
  const stored = host.store.bot(botId);
  if (!stored) return null;
  const setting = approvalModeFor({ approvalMode: stored.approvalMode, autoApprove: stored.autoApprove });
  const thread = threadId ?? stored.threadId;
  const projected = host.store.projectBotForTask(botId, thread) ?? stored;
  const applied = host.approvalModeForTurn(projected, false, thread);
  const task = host.store.taskByThread(botId, thread);
  const threadLevel = task?.approvalOwn !== undefined ? approvalModeFor({ approvalMode: projected.approvalMode, autoApprove: projected.autoApprove }) : undefined;
  const reason = appliedLevelReason(setting, applied, {
    threadException: task?.approvalOwn,
    ...(threadLevel ? { threadLevel } : {}),
    pending: Boolean(stored.approvalGrant && (!stored.approvalGrant.threadOnly || stored.approvalGrant.threadId === thread)),
    consentMissing: setting === "full" && host.orgDeniesFull(stored),
    memberPolicy: host.memberOwnedInOrg(stored) && memberTurnLevel(setting, memberAutoApprovalAllowed(host.cfg.organization)) !== setting,
    guest: host.cloudGuestDriven(thread),
    mail: host.botmailConfined(thread)
  });
  return reason ? { setting, applied: { mode: applied, reason } } : { setting };

}
  return approvalLevelOf;
}
