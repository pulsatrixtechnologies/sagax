// @ts-nocheck
/** scheduleAdminApprovalsAnnounce (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScheduleAdminApprovalsAnnounce(getHost: () => Host): any {
function scheduleAdminApprovalsAnnounce() {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || host.adminApprovalsAnnounce) return;
  host.adminApprovalsAnnounce = setTimeout(() => {
    host.adminApprovalsAnnounce = null;
    const pending = host.pendingAdminApprovals();
    const keys = new Set(pending.map((entry) => `${entry.threadId}:${entry.requestId}`));
    const added = pending.filter((entry) => !host.announcedAdminApprovals.has(`${entry.threadId}:${entry.requestId}`));
    const changed = added.length > 0 || keys.size !== host.announcedAdminApprovals.size;
    host.announcedAdminApprovals = keys;
    if (!changed) return;
    host.broadcast({
      kind: "org.approvals",
      count: pending.length,
      added: added.slice(-5).map((entry) => ({
        requestId: entry.requestId, botName: entry.botName, ownerName: entry.ownerName,
        ...(entry.requestedBy ? { requestedBy: entry.requestedBy } : {}),
        ...(entry.tool ? { tool: entry.tool } : {}),
        ...(entry.summary ? { summary: entry.summary.slice(0, 200) } : {})
      }))
    });
  }, 50);
  host.adminApprovalsAnnounce.unref?.();

}
  return scheduleAdminApprovalsAnnounce;
}
