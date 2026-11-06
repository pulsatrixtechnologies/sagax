// @ts-nocheck
/** announceProfileChange (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAnnounceProfileChange(getHost: () => Host): any {
function announceProfileChange(botId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) {
    host.announcedProfiles.delete(botId);
    return;
  }
  const profile = JSON.stringify(host.botPublicProfile(bot));
  const before = host.announcedProfiles.get(botId);
  host.announcedProfiles.set(botId, profile);
  if (before === undefined || before === profile) return;
  for (const group of host.store.groups) {
    if (group.memberIds.includes(botId)) host.broadcast({ kind: "group", group: host.publicGroupState(group) });
  }

}
  return announceProfileChange;
}
