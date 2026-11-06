// @ts-nocheck
/** moveOffComputerEngine (#1388). Pure move from server/index.ts. */
import { withoutRemovedBackup } from "../bots/bot-runtime-settings.ts";
export type Host = Record<string, any>;

export function createMoveOffComputerEngine(getHost: () => Host): any {
async function moveOffComputerEngine() {
  const host = getHost();
  const { cfg, saveConfig } = host;
  if (host.hostedModels) return;
  const removed = host.removedComputerInstanceIds(host.cfg.instances);
  const named = (selection?: { instanceId: string }) => Boolean(selection && removed.has(selection.instanceId));
  if (named(host.cfg.automaticRecovery?.backup)) {
    saveConfig({ automaticRecovery: { enabled: false } });
    host.cfg.automaticRecovery = { enabled: false };
  }
  // Each bot's own backup (server/bots/bot-runtime-settings.ts) on a removed engine.
  for (const candidate of host.store.bots) {
    const cleared = withoutRemovedBackup(candidate.automaticRecovery, (id) => removed.has(id));
    if (cleared !== candidate.automaticRecovery) host.store.patchBot(candidate.id, { automaticRecovery: cleared });
  }
  const defaults = named(host.cfg.defaultModelSelection) || named(host.cfg.newBotDefaults?.profile.modelSelection);
  if (!defaults && !host.store.bots.some(bot => named(bot.modelSelection) || bot.fallback?.some(named) ||
    host.store.tasks(bot.id).some(task => named(task.modelSelection)))) return;
  let replacement = named(host.cfg.defaultModelSelection) ? { instanceId: "", model: "" } : await host.defaultSelection();
  if (!replacement.instanceId) replacement = await host.defaultSelection(null);
  if (!replacement.instanceId) {
    console.warn("[engines] the Computer engine was removed and no other engine is available yet; its bots move when one is");
    return;
  }
  if (defaults) {
    // One write keeps both saved defaults on the replacement (saveConfig
    // syncs them), and the copies in memory follow at once, so a bot made
    // before the next start never lands on the removed engine.
    const newBotDefaults = host.cfg.newBotDefaults && host.newBotDefaultsSchema.parse({
      ...cfg.newBotDefaults, profile: { ...cfg.newBotDefaults.profile, modelSelection: replacement }
    });
    saveConfig(newBotDefaults ? { newBotDefaults } : { defaultModelSelection: replacement });
    host.cfg.defaultModelSelection = replacement;
    if (newBotDefaults) host.cfg.newBotDefaults = newBotDefaults;
  }
  const instance = host.registry.get(replacement.instanceId);
  const engine = instance?.displayName ?? instance?.driverKind ?? replacement.instanceId;
  const moves = host.store.retireInstances(removed, replacement, {
    driverKind: instance?.driverKind,
    canWorkOnCloud: host.canWorkOnCloud(host.cloudEngine(instance)),
    keepCloud: (bot) => host.boat.boatConfigured(host.cfg) && bot.cloudBackend !== "vps" && !host.inheritedTeamComputer(bot)
  });
  host.writeComputerEngineMoveLines(moves, (move) => {
    const bot = host.store.bot(move.botId);
    if (bot) host.store.appendMessage(move.threadId, { role: "bot", kind: "activity", tool: { name: host.computerEngineMoveText(move, bot.name, engine), ok: true } });
  });

}
  return moveOffComputerEngine;
}
