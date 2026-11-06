// @ts-nocheck
/** agentSummary (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentSummary(getHost: () => Host): any {
function agentSummary(bot: BotRecord) {
  const host = getHost();

  // Same owner source as profile() / get_agent: no per-agent profile call.
  const ownerId = bot.temporary?.ownerPrincipalId ?? (host.recordedBotOwner(bot) ?? null);
  const model = host.agentModelSummary(bot);
  return {
    id: bot.id,
    name: bot.name,
    description: (bot.description || bot.title || "").slice(0, 600),
    status: bot.busy || host.store.tasks(bot.id).some((task) => host.threadBusy(bot.id, task.threadId)) ? "running" : "idle",
    ...(bot.temporary ? { temporary: true } : {}),
    owner: ownerId ? { principal_id: ownerId, name: host.adminPerson(ownerId).name } : null,
    ...(model ? { model } : {}),
  };

}
  return agentSummary;
}
