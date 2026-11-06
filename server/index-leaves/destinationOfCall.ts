// @ts-nocheck
/** destinationOfCall (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDestinationOfCall(getHost: () => Host): any {
function destinationOfCall(bot: BotRecord, threadId: string, tool: string | undefined, guestDriven: boolean): { person: string; byOwner: boolean } | null {
  const host = getHost();

  const owner = host.effectiveBotOwner(bot).trim().toLowerCase();
  if (host.ownDestinationRequest(bot, threadId, tool, guestDriven)) return { person: owner, byOwner: true };
  const speaker = host.turnSpeakers.get(threadId);
  const person = speaker?.origin === "person" ? speaker.principalId?.trim().toLowerCase() ?? "" : "";
  if (!person || person === owner) return null;
  if ((host.store.taskByThread(bot.id, threadId)?.ownerPrincipalId ?? "").trim().toLowerCase() !== person) return null;
  if (host.destinationTurnOrigin(bot, threadId, person) !== "owner") return null;
  const workplace = host.turnWorkplaces.get(threadId);
  const mine = workplace?.botId === bot.id;
  return ownDestinationCall({
    identity: host.IDENTITY.kind,
    tool,
    environmentPrincipalId: mine ? workplace.decision.principal : null,
    ownerPrincipalId: person,
    guestDriven,
    mountedServers: (mine && workplace.ownEnvironmentServers) || new Set<string>()
  }) ? { person, byOwner: false } : null;

}
  return destinationOfCall;
}
