// The retired every-Claude toggle used the installation key on subscription
// instances too. Preserve those saved payers on claudeApi before marking the
// migration complete. Custom endpoints and explicit credentials stay theirs.
import { createHash } from "node:crypto";
import { CLAUDE_API_INSTANCE, instanceConfigs, instanceOwnsRouting, persistableInstanceConfigs, type AppConfig, type saveConfig } from "../config.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";

interface Retirement {
  ids: ReadonlyMap<string, string>;
  patch: Parameters<typeof saveConfig>[0];
}

/** Prepare before the registry starts, so a custom CLI's paid counterpart
 * is present on the first migrated turn. Nothing is persisted here. */
export function prepareEveryClaudeRetirement(cfg: AppConfig): Retirement | undefined {
  if (!cfg.anthropic?.key || cfg.anthropic.everyClaudeBot === false) return;
  const ids = new Map<string, string>();
  let instances: AppConfig["instances"];
  for (const [id, entry] of Object.entries(instanceConfigs(cfg))) {
    if (id === CLAUDE_API_INSTANCE || entry.driver !== "claudeAgent" || instanceOwnsRouting(cfg, entry)) continue;
    const source = cfg.instances?.[id];
    const custom = source && (source.enabled !== undefined || Object.keys(source.environment ?? {}).length > 0
      || (source.config && typeof source.config === "object" && Object.keys(source.config).length > 0));
    if (!custom) { ids.set(id, CLAUDE_API_INSTANCE); continue; }
    instances ??= persistableInstanceConfigs(cfg);
    const base = `${CLAUDE_API_INSTANCE}-${createHash("sha256").update(id).digest("hex").slice(0, 12)}`;
    let target = base;
    for (let suffix = 2; Object.hasOwn(instances, target); suffix++) target = `${base}-${suffix}`;
    instances[target] = { ...source, driver: "claudeAgent", access: "api", displayName: `${source.displayName ?? id} (API key)`,
      config: { ...(source.config as object | undefined), requireApiKey: true } };
    ids.set(id, target);
  }
  const move = (selection: ModelSelection): ModelSelection => ({
    ...selection,
    instanceId: ids.get(selection.instanceId) ?? selection.instanceId,
    ...(selection.fast ? { fast: { ...selection.fast, instanceId: ids.get(selection.fast.instanceId) ?? selection.fast.instanceId } } : {}),
  });
  const patch: Parameters<typeof saveConfig>[0] = { anthropic: { everyClaudeBot: false } };
  if (cfg.defaultModelSelection) patch.defaultModelSelection = move(cfg.defaultModelSelection);
  if (cfg.newBotDefaults) patch.newBotDefaults = {
    ...cfg.newBotDefaults,
    profile: { ...cfg.newBotDefaults.profile, ...(cfg.newBotDefaults.profile.modelSelection ? { modelSelection: move(cfg.newBotDefaults.profile.modelSelection) } : {}) },
  };
  if (cfg.automaticRecovery) patch.automaticRecovery = {
    ...cfg.automaticRecovery, ...(cfg.automaticRecovery.backup ? { backup: move(cfg.automaticRecovery.backup) } : {}),
  };
  if (cfg.disabledModels) patch.disabledModels = [...new Set(cfg.disabledModels.map((key) => {
    const slash = key.indexOf("/");
    const replacement = slash > 0 ? ids.get(key.slice(0, slash)) : undefined;
    // The switch follows the old paid account, just like its saved choices.
    return replacement ? `${replacement}${key.slice(slash)}` : key;
  }))];
  if (instances) patch.instances = instances;
  return { ids, patch };
}

export function retireEveryClaudeBot(
  cfg: AppConfig,
  store: { renameInstances(ids: ReadonlyMap<string, string>): number },
  persist: typeof saveConfig,
  prepared = prepareEveryClaudeRetirement(cfg),
): boolean {
  if (!prepared) return false;
  const { ids, patch } = prepared;
  store.renameInstances(ids);
  persist(patch);
  // A process whose key came from the environment must keep it in memory;
  // only the retired flag, never that credential, is added to the file.
  Object.assign(cfg, patch, { anthropic: { ...cfg.anthropic, everyClaudeBot: false } });
  return true;
}
