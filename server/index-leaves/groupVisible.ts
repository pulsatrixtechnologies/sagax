// @ts-nocheck
/** groupVisible (#1388). Pure move from server/index.ts. */
import { seesChannel } from "../rooms/channel-visibility.ts";
import { pairChannelOwnedBy } from "../groups/group-ownership.ts";
export type Host = Record<string, any>;

export function createGroupVisible(getHost: () => Host): any {
function groupVisible(group: { id?: unknown; humanIds?: string[]; memberIds?: string[]; section?: unknown; dm?: boolean; peopleDm?: boolean; archivedAt?: number }, viewerId: string | undefined) {
  const host = getHost();

  // The last person left it (server/groups/group-leave.ts): kept, listed to no one.
  if (group.archivedAt) return false;
  // A conversation between two people is theirs alone (server/people/people-dms.ts):
  // not an admin's, a section's, nor the operator's at this computer.
  if (group.peopleDm) return host.isPeopleDmParticipant(group, viewerId);
  if (!viewerId) return true;
  // #5152: on an organization server a bot pair's channel (no people by
  // design) is its bots' owner's, the operator at this computer's included
  if (group.dm && host.IDENTITY.kind === "perspicax" && pairChannelOwnedBy(group, viewerId, (botId: string) => {
    const bot = host.store.bot(botId);
    return bot ? host.effectiveBotOwner(bot) : undefined;
  })) return true;
  return seesChannel(group, viewerId, host.authzViewerFromId(viewerId), host.roomSectionAccess(group));

}
  return groupVisible;
}
