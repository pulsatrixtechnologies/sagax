// @ts-nocheck
/** listedBotVisible (#1388). Pure move from server/index.ts. */
import { seesBotForViewer } from "../rooms/channel-visibility.ts";
export type Host = Record<string, any>;

export function createListedBotVisible(getHost: () => Host): any {
function listedBotVisible(bot: { id: string; ownerUserId?: unknown; directGrants?: unknown; grants?: unknown; section?: unknown }, viewerId: string | undefined) {
  const host = getHost();

  const facts = host.botFacts(bot);
  return seesBotForViewer({
    viewerId,
    ownerUserId: facts.ownerPrincipalId,
    directGrants: host.botDirectGrants(bot),
    inChannels: host.store.groups.filter((group) => group.memberIds.includes(bot.id)).map((group) => ({ humanIds: group.humanIds ?? [], section: host.roomSectionAccess(group) })),
    // Organization: a room opens itself, never its bots' Directs or their
    // own routes (bot.use decides those; room turns go through the room).
    channelsOpenBot: host.IDENTITY.kind !== "perspicax",
    viewer: host.authzViewerFromId(viewerId),
    grants: facts.grants,
    sections: facts.sections,
    everyone: facts.everyone
  });

}
  return listedBotVisible;
}
