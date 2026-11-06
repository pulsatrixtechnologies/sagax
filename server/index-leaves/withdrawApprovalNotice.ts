// @ts-nocheck
/** withdrawApprovalNotice (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWithdrawApprovalNotice(getHost: () => Host): any {
function withdrawApprovalNotice(threadId: string, requestId: string) {
  const host = getHost();

  const key = `${threadId}\0${requestId}`;
  if (host.withdrawnApprovalNotices.has(key)) return;
  if (host.withdrawnApprovalNotices.size >= 5_000) host.withdrawnApprovalNotices.clear();
  host.withdrawnApprovalNotices.add(key);
  host.broadcast({ kind: "notify-withdraw", threadId, requestId });
  host.pushHub.noteSettled(threadId, requestId);
  host.reachMeService?.cardSettled(threadId, requestId);
  host.settleWaitingActivity(threadId);

}
  return withdrawApprovalNotice;
}
