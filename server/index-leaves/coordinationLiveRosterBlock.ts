// @ts-nocheck
/** coordinationLiveRosterBlock (#1388). Pure move from server/index.ts. */
import { livePeerRoster, livePeerRosterBlock } from "../peers/peer-roster.ts";
export type Host = Record<string, any>;

export function createCoordinationLiveRosterBlock(getHost: () => Host): any {
function coordinationLiveRosterBlock(recipient: BotRecord) {
  const host = getHost();
  const { reachablePeers } = host;

  const instance = host.registry.get(recipient.modelSelection.instanceId);
  if (instance?.adapter.capabilities.agentsMcp !== true) return "";
  const team = reachablePeers(host.store.bots, recipient).map(peer => ({
    ...peer,
    lastActivityAt: host.newestPeerActivityAt(peer.id)
  }));
  return livePeerRosterBlock(livePeerRoster(team));

}
  return coordinationLiveRosterBlock;
}
