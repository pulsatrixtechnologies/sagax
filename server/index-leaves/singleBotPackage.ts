// @ts-nocheck
/** singleBotPackage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSingleBotPackage(getHost: () => Host): any {
function singleBotPackage(bot: BotRecord, withRoutines: boolean) {
  const host = getHost();
  const { TeamExportError, createTeamPackageExport, sectionKey } = host;
  const team = sectionKey(bot.section);
  const exportable = { ...bot, hidden: false } as BotRecord;
  const skills = host.collectTeamSkills([exportable], "all");
  if (!skills.ok) throw new host.ConsoleRefusal(409, "skills_unreadable", skills.error);
  try {
    return createTeamPackageExport({
      team,
      name: bot.name,
      authorName: host.cfg.profile?.name?.trim(),
      bots: [exportable],
      groups: [],
      routines: withRoutines ? (host.routines?.listRoutines() ?? []).filter((routine) => routine.botId === bot.id) : [],
      published: null,
      skillsByBot: skills.skillsByBot,
      skillSelection: "all",
      mcpServers: host.cfg.mcpServers ?? {},
      skipped: skills.skipped,
      preset: null
    });
  } catch (error) {
    if (error instanceof TeamExportError) throw new host.ConsoleRefusal(error.status, "export_refused", error.message);
    throw error;
  }

}
  return singleBotPackage;
}
