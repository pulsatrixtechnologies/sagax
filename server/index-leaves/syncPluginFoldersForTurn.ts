// @ts-nocheck
/** syncPluginFoldersForTurn (#1388). Pure move from server/index.ts. */
import { pluginCopyFailures, SANDBOX_CAPABILITY_SKILLS_DIR, SANDBOX_PLUGINS_DIR, sandboxPluginPresence, syncPluginRootsToSandbox } from "../sandbox/sandbox-plugins.ts";

export type Host = Record<string, any>;

export function createSyncPluginFoldersForTurn(getHost: () => Host): any {
async function syncPluginFoldersForTurn(principalId: string, botId: string, limit: <T>(task: () => Promise<T>) => Promise<T> = (task) => task()) {
  const host = getHost();
  const { skillsLibraryEnabled } = host;

  const bot = host.store.bot(botId);
  if (!bot || !host.userSandbox) return;
  // A private bot install stays with its owner. Organization and personal
  // installs are selected for the person whose environment receives them.
  const plugins = host.scopedPluginFolders(bot, principalId).filter((plugin) => plugin.scope !== "bot" || host.samePerson(host.effectiveBotOwner(bot), principalId));
  const skills = skillsLibraryEnabled(host.cfg) && host.personalSkills.enabled(principalId).length ? [{ name: "me", dir: host.personalSkills.root(principalId) }] : [];
  if (!plugins.length && !skills.length) return;
  // #3440: the copy's commands wait in the person's line like the bots' own
  // (sandbox-exec-queue.ts): the bot's turn waits for this copy, so it must
  // not wait behind the other bots; `limit` keeps it to two places at once
  const target = { exec: (input) => limit(() => host.userSandbox!.exec(principalId, input, botId)) };
  // #3619: what this environment holds is remembered (two bots of one
  // person on one environment share it): plugins that did not change send
  // no command, and the markers left to check are read in one command
  const options = {
    failures: pluginCopyFailures, scope: principalId,
    presence: host.sandboxPluginPresence ?? sandboxPluginPresence,
    environment: host.userSandbox.environmentOf?.(principalId, botId) ?? principalId,
    ...(host.pluginFolderDigests ? { digests: host.pluginFolderDigests } : {}),
  };
  const report = (result) => {
    if (result.skipped.length) console.warn(`[plugins] not copied to the server environment: ${result.skipped.map((row) => `${row.name} (${row.reason})`).join(", ")}`);
  };
  try {
    report(await syncPluginRootsToSandbox([
      ...(skills.length ? [{ root: SANDBOX_CAPABILITY_SKILLS_DIR, plugins: skills }] : []),
      { root: SANDBOX_PLUGINS_DIR, plugins },
    ], target, options));
  } catch (error) {
    console.warn(`[plugins] server environment not updated: ${error instanceof Error ? error.message : String(error)}`);
  }

}
  return syncPluginFoldersForTurn;
}
