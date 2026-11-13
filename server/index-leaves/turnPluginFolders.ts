// @ts-nocheck
/** turnPluginFolders (#4082): the plugin folders a bot's turn reads on this
 * server. When the turn's commands run in the person's environment (Sagax
 * mounted it for this bot's turn: mountUserSandbox), each folder is the copy
 * whose skill, command and agent text names the plugin's paths there, so
 * workspace_read, whole skills in the prompt and the native skill links of
 * file engines name runnable paths, as Claude's `--plugin-dir` copy does. */
import { pluginFoldersInEnvironment, pluginTurnCopiesDir } from "../drivers/claude/plugin-agent-tools.ts";
import { USER_SANDBOX_MCP_NAME } from "../sandbox/user-sandbox-routing.ts";
export type Host = Record<string, any>;

export function createTurnPluginFolders(getHost: () => Host): any {
function turnPluginFolders(bot: { id: string; ownerUserId?: unknown }, person: string | undefined, threadId: string | undefined): Array<{ name: string; dir: string; scope: PluginScope }> {
  const host = getHost();
  const plugins = host.scopedPluginFolders(bot, person);
  const workplace = threadId ? host.turnWorkplaces.get(threadId) : undefined;
  if (workplace?.botId !== bot.id || !workplace.ownEnvironmentServers?.has(USER_SANDBOX_MCP_NAME)) return plugins;
  return pluginFoldersInEnvironment(plugins, pluginTurnCopiesDir(host.DATA_DIR));
}
  return turnPluginFolders;
}
