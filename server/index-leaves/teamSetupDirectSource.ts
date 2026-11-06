// @ts-nocheck
/** teamSetupDirectSource (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTeamSetupDirectSource(getHost: () => Host): any {
function teamSetupDirectSource(botId: string, threadId: string, request: TeamSetupRequest) {
  const host = getHost();

  const from = host.store.bot(botId);
  if (!from) return null;
  const ownerOf = (bot: BotRecord) => host.effectiveBotOwner(bot).trim().toLowerCase();
  return host.teamSetupDirectApply({
    request,
    fullAccess: host.fullAccessForSource(botId, threadId),
    blocked: host.selfApplyBlocked(threadId) || !host.connectorThread(botId, threadId),
    mode: host.sourceApprovalMode(botId, threadId),
    ownerTurn: host.ownEnvironmentOrigin(from, threadId) === "owner",
    orgServer: host.IDENTITY.kind === "perspicax",
    requesterOwner: ownerOf(from),
    ownerOf: (id) => { const target = host.store.bot(id); return target ? ownerOf(target) : null; }
  });

}
  return teamSetupDirectSource;
}
