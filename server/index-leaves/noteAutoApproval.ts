// @ts-nocheck
/** noteAutoApproval (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNoteAutoApproval(getHost: () => Host): any {
function noteAutoApproval(threadId: string, names: ReadonlyArray<string | undefined>, approval: ToolAutoApproval, notice?: CustomRuleNotice) {
  const host = getHost();

  const rows = host.store.messagesFor(threadId);
  const row = host.autoApprovals.rowFor(rows, names);
  if (row?.tool) {
    host.store.patchMessage(threadId, row.id, { tool: { ...row.tool, autoApproval: approval, ...(notice ? { ruleNotice: notice } : {}) } });
    return;
  }
  host.autoApprovals.remember(threadId, names, approval, notice);

}
  return noteAutoApproval;
}
