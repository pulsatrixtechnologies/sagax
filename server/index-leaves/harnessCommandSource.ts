// @ts-nocheck
/** harnessCommandSource (#1388). Pure move from server/index.ts. */
import { harnessEngineFor } from "../harness-commands.ts";
export type Host = Record<string, any>;

export function createHarnessCommandSource(getHost: () => Host): any {
function harnessCommandSource(bot: BotRecord, threadId: string | undefined, options: HarnessCommandSourceOptions = {}) {
  const host = getHost();
  const { claudeUserMcpEnabled, ensureTaskWorkspace, pluginDirsFor, supportsWorkspaceFiles } = host;
  // the bot keeps its own engine wherever it works (upstream #2220)
  const instance = host.registry.get(bot.modelSelection.instanceId);
  const engine = instance ? harnessEngineFor(instance.driverKind) : null;
  if (!instance?.listCommands || !engine) return null;
  let cwd: string | undefined;
  if (options.group) cwd = threadId ? host.groupCommandCwd(bot, instance, options.group, threadId) : undefined;
  else {
    const task = threadId ? host.store.taskByThread(bot.id, threadId) : undefined;
    // the folder the thread's next turn runs in (see the pin in runTurn)
    cwd = task && task.cwd !== undefined ? task.cwd ?? undefined
      : bot.cwd ?? (task && threadId && supportsWorkspaceFiles(instance.driverKind) ? ensureTaskWorkspace(bot.id, threadId) : undefined);
  }
  const list = instance.listCommands.bind(instance);
  const account = options.speaker ? host.harnessCommandAccount(bot, instance, options.speaker, options.access) : {};
  return {
    botId: bot.id,
    instanceId: instance.instanceId,
    engine,
    scope: {
      ...(options.scope ?? {
        botId: bot.id,
        ...(cwd ? { cwd } : {}),
        ...(host.withholdHostToolsFor(instance) ? { withholdHostTools: true } : {}),
        mcpFromUserConfig: claudeUserMcpEnabled(host.cfg, host.IDENTITY.kind === "perspicax") && !host.managedPolicy.restrictsMcp(),
        ...pluginDirsFor(bot, instance, options.speaker ? host.orgSpeakerPrincipal(bot, options.speaker) : undefined)
      }),
      ...account
    },
    list
  };

}
  return harnessCommandSource;
}
