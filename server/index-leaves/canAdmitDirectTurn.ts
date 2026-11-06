// @ts-nocheck
/** canAdmitDirectTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCanAdmitDirectTurn(getHost: () => Host): any {
function canAdmitDirectTurn(botId: string, threadId: string) {
  const host = getHost();
  return host.admit("peer", {}, {
    threadBusy: host.threadBusy(botId, threadId),
    // 2026-11-01: startTurn's own rule (server/team/teammate-replies.ts), the
    // person's main chat never at capacity: a teammate's reply into it was
    // held while the person could still chat there, until the tree failed
    // as stalled.
    atCapacity: host.botAtThreadCapacity(botId, threadId),
    groupTurn: Boolean(host.activeGroupTurnForBot(botId))
  }).action === "start";

}
  return canAdmitDirectTurn;
}
