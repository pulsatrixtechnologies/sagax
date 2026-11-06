// @ts-nocheck
/** commandAllowlistResponse (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCommandAllowlistResponse(getHost: () => Host): any {
function commandAllowlistResponse(bot: BotRecord) {
  const host = getHost();
  const { DATA_DIR, existsSync, realpathSync } = host;

  const instance = host.registry.get(bot.modelSelection.instanceId);
  const task = host.store.taskByThread(bot.id, bot.threadId);
  let cwd = task?.cwd !== undefined ? task.cwd : bot.cwd ?? join(realpathSync(DATA_DIR), "task-workspaces", bot.id, bot.threadId);
  if (cwd && existsSync(cwd)) cwd = realpathSync(cwd);
  return {
    rules: host.commandAllowlist.list(bot.id),
    supported: host.COMMAND_ALLOWLIST_DRIVERS.has(instance?.driverKind ?? ""),
    context: {
      providerInstanceId: bot.modelSelection.instanceId,
      cwd
    }
  };

}
  return commandAllowlistResponse;
}
