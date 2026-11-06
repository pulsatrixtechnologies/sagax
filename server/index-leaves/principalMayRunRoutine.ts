// @ts-nocheck
/** principalMayRunRoutine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPrincipalMayRunRoutine(getHost: () => Host): any {
function principalMayRunRoutine(principalId: string, run: { botId: string; target?: string; groupId?: string }) {
  const host = getHost();
  const { atLeast, botFacts, botLevel } = host;
  const bot = host.store.bot(run.botId);
  if (!bot) return false;
  const viewer = host.authzViewerFromId(principalId);
  if (!viewer || !atLeast(botLevel({ viewer, ...botFacts(bot) }), "run")) return false;
  if (run.target === "room-goal" && run.groupId) {
    const group = host.store.group(run.groupId);
    if (!group || !host.groupVisible(group, principalId)) return false;
  }
  return true;

}
  return principalMayRunRoutine;
}
