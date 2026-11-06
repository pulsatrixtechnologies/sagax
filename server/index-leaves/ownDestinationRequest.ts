// @ts-nocheck
/** ownDestinationRequest (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOwnDestinationRequest(getHost: () => Host): any {
function ownDestinationRequest(bot: BotRecord, threadId: string, tool: string | undefined, guestDriven: boolean) {
  const host = getHost();

  const workplace = host.turnWorkplaces.get(threadId);
  const mine = workplace?.botId === bot.id;
  return ownDestinationCall({
    identity: host.IDENTITY.kind,
    tool,
    environmentPrincipalId: mine ? workplace.decision.principal : null,
    ownerPrincipalId: host.effectiveBotOwner(bot),
    guestDriven,
    mountedServers: (mine && workplace.ownEnvironmentServers) || new Set<string>()
  });

}
  return ownDestinationRequest;
}
