// @ts-nocheck
/** botOverview (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotOverview(getHost: () => Host): any {
async function botOverview(bot: BotRecord) {
  const host = getHost();
  const { builtInBrowserEnabled, reachablePeers } = host;
  const engine = host.registry.get(bot.modelSelection.instanceId)?.adapter.capabilities ?? null;
  const sectionPeers = reachablePeers(host.store.bots, bot).length;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Same flush as GET /history: profile-change rows queue in
  // profile-versions.ts and land asynchronously, so a client checking the
  // overview right after causing a change must see its own row.
  await host.flushProfileHistory(bot.id);
  const recent = host.readHistory(bot.id, 5).map((r) => ({ at: r.at, summary: r.summary }));
  return host.buildBotOverview({
    bot: {
      name: bot.name,
      title: bot.title,
      description: bot.description,
      soul: bot.soul,
      computer: bot.computer,
      cloudBackend: bot.cloudBackend,
      cwd: bot.cwd,
      autoApprove: bot.autoApprove,
      approvalMode: host.approvalModeForTurn(bot),
      approvePeerComms: bot.approvePeerComms,
      peers: bot.peers,
      browser: bot.browser,
      chiefOfStaff: bot.chiefOfStaff,
      managedSections: bot.managedSections
    },
    routines: host.routines!.listRoutines()
      .filter((routine) => routine.botId === bot.id)
      .map((routine) => ({
        id: routine.id,
        name: routine.name,
        enabled: routine.enabled,
        schedule: routine.schedule,
        nextRunAt: routine.nextRunAt
      })),
    runs: host.routines!.listRunsForBot(bot.id)
      .map((run) => ({
        routineId: run.routineId,
        status: run.status,
        finishedAt: run.finishedAt,
        startedAt: run.startedAt,
        scheduledFor: run.scheduledFor
      })),
    webhooks: host.webhooks.list()
      .filter((webhook) => webhook.botId === bot.id)
      .map((webhook) => ({ name: webhook.name, enabled: webhook.enabled })),
    skills: host.listBotSkills(bot).map((skill) => ({
      name: skill.name,
      description: skill.description,
      enabled: skill.enabled
    })),
    engine,
    browserEnabled: builtInBrowserEnabled(host.cfg),
    cloudHome: false,
    sectionPeers,
    timeZone,
    recent
  });

}
  return botOverview;
}
