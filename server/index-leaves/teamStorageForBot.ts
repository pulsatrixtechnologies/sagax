// @ts-nocheck
/** teamStorageForBot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTeamStorageForBot(getHost: () => Host): any {
function teamStorageForBot(bot: { section?: string; sectionId?: string; ownerUserId?: string } | null | undefined): { key: string; label: string } {
  const host = getHost();
  const { sectionContextKey, sectionContextLabel, teamDataKey } = host;

  const owner = bot ? host.effectiveBotOwner(bot) : "";
  // #2045: prefer the stamped section id so a rename never moves team data.
  if (bot?.sectionId && host.sectionChannels) {
    const byId = host.sectionChannels.byId(bot.sectionId);
    if (byId) return { key: teamDataKey(byId.ownerPrincipalId, byId.id), label: byId.name };
  }
  const name = sectionContextKey(bot?.section);
  if (!name) return { key: "", label: "General" };
  const record = host.sectionChannels && owner ? host.sectionChannels.byNameForOwner(name, owner) : null;
  if (record) return { key: teamDataKey(record.ownerPrincipalId, record.id), label: record.name };
  return { key: name, label: sectionContextLabel(name) };

}
  return teamStorageForBot;
}
