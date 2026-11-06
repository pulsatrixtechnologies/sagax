// @ts-nocheck
/** reachMeAudit (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReachMeAudit(getHost: () => Host): any {
function reachMeAudit(row: { person: string; botId: string; threadId: string; channel: ReachChannelId; action: string; outcome?: string; reason?: string }) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction, isPrincipalId } = host;
  try {
    appendAdminAction(DATA_DIR, {
      category: "approval",
      action: `reach-me.${row.action}`,
      target: host.auditBotTarget(row.botId),
      // metadata only: never the person's text, never a full number
      after: { channel: row.channel, ...(row.outcome ? { outcome: row.outcome } : {}), ...(row.reason ? { reason: row.reason } : {}) },
      actor: host.IDENTITY.kind === "perspicax" && isPrincipalId(row.person) ? { kind: "person", principalId: row.person, via: "sagax" } : { kind: "loopback" }
    });
  } catch { /* the journal is a record, never a reason to fail */ }

}
  return reachMeAudit;
}
