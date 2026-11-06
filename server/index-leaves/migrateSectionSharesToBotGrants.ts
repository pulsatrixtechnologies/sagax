// @ts-nocheck
/** migrateSectionSharesToBotGrants (#1388). Pure move from server/index.ts. */
import { levelRank } from "../auth/authz.ts";
import { SectionChannels, sectionShareGrants } from "../rooms/section-channels.ts";
// Imported, not read from the host: this runs at start, before the host binds sectionKey.
import { sectionKey } from "../store.ts";
export type Host = Record<string, any>;

export function createMigrateSectionSharesToBotGrants(getHost: () => Host): any {
function migrateSectionSharesToBotGrants(channels: SectionChannels) {
  const host = getHost();
  const { botGrants } = host;
  if (channels.botSharesMigrated()) return;
  const wanted = sectionShareGrants(channels, host.store.bots.map((bot) => ({ id: bot.id, section: sectionKey(bot.section) || undefined, ownerPrincipalId: host.effectiveBotOwner(bot) })));
  const sections = new Set(wanted.map((grant) => grant.section));
  const botIds = new Set(wanted.map((grant) => grant.botId));
  let added = 0;
  let raised = 0;
  for (const botId of botIds) {
    const bot = host.store.bot(botId);
    if (!bot) continue;
    const next = [...botGrants(bot)];
    let changed = false;
    for (const grant of wanted.filter((entry) => entry.botId === botId)) {
      const index = next.findIndex((entry) => entry.target === grant.target);
      if (index < 0) {
        next.push({ target: grant.target, level: grant.level, by: grant.by, at: Date.now() });
        added += 1;
        changed = true;
      } else if (levelRank(next[index]!.level) < levelRank(grant.level)) {
        next[index] = { ...next[index]!, level: grant.level };
        raised += 1;
        changed = true;
      }
    }
    if (changed) host.store.setBotGrants(botId, next);
  }
  channels.markBotSharesMigrated();
  console.log(`sections: sections are personal; ${sections.size} shared section(s) became bot shares on ${botIds.size} bot(s) (${added} added, ${raised} raised)`);

}
  return migrateSectionSharesToBotGrants;
}
