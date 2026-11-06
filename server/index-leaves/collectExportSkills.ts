// @ts-nocheck
/** collectExportSkills (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCollectExportSkills(getHost: () => Host): any {
function collectExportSkills(   bots: readonly BotRecord[],   names: readonly string[], ) {
  const host = getHost();

  const selected = new Set(names);
  const byBot = new Map<string, ExportablePackageSkill[]>();
  if (!selected.size) return byBot;
  for (const bot of bots) {
    const assigned: ExportablePackageSkill[] = [];
    for (const listing of host.listBotSkills(bot)) {
      if (!selected.has(listing.name)) continue;
      const instructions = host.readBotSkillFile(bot, listing.name);
      if (instructions === null) {
        throw new Error(`Skill "${listing.name}" changed or is unavailable and cannot be exported safely`);
      }
      const skill: ExportablePackageSkill = {
        name: listing.name,
        description: listing.description,
        ...(listing.source ? { source: listing.source } : {}),
        ...(listing.license ? { license: listing.license } : {}),
        ...(listing.compatibility ? { compatibility: listing.compatibility } : {}),
        instructions
      };
      // The shared exporter validates duplicate bytes and metadata together.
      assigned.push(skill);
    }
    if (assigned.length) byBot.set(bot.id, assigned);
  }
  return byBot;

}
  return collectExportSkills;
}
