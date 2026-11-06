// @ts-nocheck
/** collectTeamSkills (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCollectTeamSkills(getHost: () => Host): any {
function collectTeamSkills(
  bots: readonly BotRecord[],
  selection: unknown,
): { ok: true; all: boolean; skillsByBot: Map<string, ExportablePackageSkill[]>; skipped: TeamExportSkip[]; available: string[] } | { ok: false; error: string; available: string[] } {
  const host = getHost();

  const all = selection === undefined || selection === "all";
  const available = [...new Set(bots.flatMap((bot) => host.listBotSkills(bot).map((skill) => skill.name)))].sort();
  if (!all && (!Array.isArray(selection) || selection.some((name) => typeof name !== "string" || !isSkillName(name)))) {
    return { ok: false, error: "skills must be \"all\" or a list of skill names", available };
  }
  const chosen = new Set(all ? available : selection as string[]);
  const unknown = [...chosen].find((name) => !available.includes(name));
  if (unknown) return { ok: false, error: `This team has no skill named "${unknown}"`, available };
  const skillsByBot = new Map<string, ExportablePackageSkill[]>();
  const skipped: TeamExportSkip[] = [];
  for (const bot of bots) {
    const assigned: ExportablePackageSkill[] = [];
    for (const listing of host.listBotSkills(bot)) {
      if (!chosen.has(listing.name)) continue;
      const instructions = host.readBotSkillFile(bot, listing.name);
      if (instructions === null) {
        if (!all) return { ok: false, error: `Skill "${listing.name}" changed or is unavailable and cannot be shared safely`, available };
        const part = `skills[${listing.name}]`;
        if (!skipped.some((skip) => skip.part === part)) skipped.push({ part, reason: "skill_changed" });
        continue;
      }
      assigned.push({
        name: listing.name,
        description: listing.description,
        ...(listing.source ? { source: listing.source } : {}),
        ...(listing.license ? { license: listing.license } : {}),
        ...(listing.compatibility ? { compatibility: listing.compatibility } : {}),
        instructions,
        enabled: listing.enabled
      });
    }
    if (assigned.length) skillsByBot.set(bot.id, assigned);
  }
  return { ok: true, all, skillsByBot, skipped, available };

}
  return collectTeamSkills;
}
