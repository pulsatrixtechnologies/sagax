// @ts-nocheck
/** applyDelegatedLevel (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createApplyDelegatedLevel(getHost: () => Host): any {
function applyDelegatedLevel(from: BotRecord, fromThreadId: string, target: BotRecord, threadId: string) {
  const host = getHost();

  const level = host.delegatedLevel(from, fromThreadId, target, host.ownThreadLevel(target, threadId));
  if (!level || host.store.taskByThread(target.id, threadId)?.approvalMode === level) return;
  // 2026-10-17 (re-review of #688): a Primary Bot's Auto or Auto-accept
  // edits is never saved on a member's thread while the organization turned
  // automatic levels off for members' bots; the thread keeps its own level.
  if (host.memberAutoRefused(target, [host.store.taskByThread(target.id, threadId)?.approvalMode], level)) {
    host.store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: `${host.DELEGATED_LEVEL_NAMES[level] ?? level} not passed on by ${from.name}: automatic levels are off for members' bots in this organization`, ok: false }
    });
    return;
  }
  host.store.patchTask(target.id, threadId, { approvalMode: level, autoApprove: false, alwaysAllow: [], approvalOwn: "delegated" });
  const name = host.DELEGATED_LEVEL_NAMES[level] ?? level;
  host.store.appendMessage(threadId, {
    role: "bot",
    kind: "activity",
    tool: { name: `${name} — delegated by ${from.name}, a Primary Bot on ${name}`, ok: true }
  });

}
  return applyDelegatedLevel;
}
