// @ts-nocheck
/** migrateThreadOwners (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMigrateThreadOwners(getHost: () => Host): any {
function migrateThreadOwners() {
  const host = getHost();
  const { isPrincipalId, saveConfig } = host;

  if (!host.privateThreads() || host.cfg.privateThreadsMigratedAt) return;
  const plan = planThreadOwners(
    host.store.bots.map((bot) => ({ id: bot.id, ownerPrincipalId: host.effectiveBotOwner(bot), tasks: host.store.tasks(bot.id) })),
    (threadId) => host.store.messagesFor(threadId).flatMap((message) => (message.role === "user" && !message.peerAsk && message.sender?.id ? [message.sender.id] : [])),
    (id) => isPrincipalId(id) && Boolean(host.principals.byId(id)),
  );
  host.store.assignTaskOwners(plan.assignments);
  console.log(migrationLogLine(plan.report));
  host.cfg.privateThreadsMigratedAt = Date.now();
  saveConfig({ privateThreadsMigratedAt: host.cfg.privateThreadsMigratedAt });

}
  return migrateThreadOwners;
}
