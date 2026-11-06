// @ts-nocheck
/** ownEnvironmentRequest (#1388). Pure move from server/index.ts. */
import { memberEnvironmentAutonomyAllowed, ownEnvironmentCall } from "../people/member-environment.ts";
export type Host = Record<string, any>;

export function createOwnEnvironmentRequest(getHost: () => Host): any {
function ownEnvironmentRequest(bot: BotRecord, threadId: string, tool: string | undefined, guestDriven: boolean) {
  const host = getHost();

  const workplace = host.turnWorkplaces.get(threadId);
  const mine = workplace?.botId === bot.id;
  return ownEnvironmentCall({
    identity: host.IDENTITY.kind,
    policyAllowed: memberEnvironmentAutonomyAllowed(host.cfg.organization),
    tool,
    environmentPrincipalId: mine ? workplace.decision.principal : null,
    ownerPrincipalId: host.effectiveBotOwner(bot),
    guestDriven,
    mountedServers: (mine && workplace.ownEnvironmentServers) || new Set<string>()
  });

}
  return ownEnvironmentRequest;
}
