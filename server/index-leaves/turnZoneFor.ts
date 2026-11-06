// @ts-nocheck
/** turnZoneFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnZoneFor(getHost: () => Host): any {
function turnZoneFor(bot: { ownerUserId?: unknown }, speaker: TurnSpeaker) {
  const host = getHost();
  const { isPrincipalId } = host;

  const personZone = (principal: string | null | undefined) => (principal && isPrincipalId(principal) ? host.botSettings.person(principal).timeZone : null);
  const owner = host.effectiveBotOwner(bot);
  return host.turnTimeZone({
    speaker: host.IDENTITY.kind === "perspicax" ? personZone(host.orgSpeakerPrincipal(bot, speaker)) : null,
    owner: host.IDENTITY.kind === "perspicax" ? personZone(owner.trim().toLowerCase()) : null,
    server: host.botSettings.server().timeZone
  });

}
  return turnZoneFor;
}
