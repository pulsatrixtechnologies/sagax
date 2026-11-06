// @ts-nocheck
/** autoEnginesFor (#1388). Pure move from server/index.ts. */
import { modelOn } from "../../shared/offered-models.ts";
export type Host = Record<string, any>;

export function createAutoEnginesFor(getHost: () => Host): any {
function autoEnginesFor(bot: BotRecord, speaker: TurnSpeaker, guestConfined = false, excluded?: AutoModelExcluded[]) {
  const host = getHost();
  const { approvalModeFor, engineProbes, isLoginDriver, modelSwitchNeedsAsk, resolveEngineAccess } = host;
  const base = host.registry.get(bot.modelSelection.instanceId);
  const mode = approvalModeFor(bot);
  const engines: AutoEngine[] = [];
  // Solo: which engines are signed in comes from the probe cache; a stale
  // or empty cache refreshes in the background and counts as unknown.
  if (host.IDENTITY.kind !== "perspicax" && (!host.engineProbes.size || [...engineProbes.values()].some((probe) => Date.now() - probe.at > host.ENGINE_PROBE_TTL_MS))) {
    void host.probeEngines().catch(host.reportBackgroundError);
  }
  const payer = host.autoPayerKey(bot, speaker);
  for (const instance of host.registry.instances()) {
    // Another person's endpoint is never named, including in exclusions.
    if (!host.personalProviderInstances.visible(instance.instanceId, host.IDENTITY.kind === "perspicax" ? payer : "solo")) continue;
    const omit = (reason: AutoExclusionReason) => excluded?.push({ instanceId: instance.instanceId, engineLabel: host.engineDisplayName(instance), reason });
    if (!instance.enabled || host.providerInstancesChanging.has(instance.instanceId)) { omit("offline"); continue; }
    if (host.policyModelRefusal(instance)) { omit("policy"); continue; }
    // 2026-10-30: Auto picks only what the organization's list allows, even
    // when the person's own account could run another engine (that one is
    // picked by name, when the organization lets own accounts through).
    if (!host.consoleEngineAllowed(instance.instanceId)) { omit("adminOff"); continue; }
    if (host.orgEngineTurnRefusal(bot, instance, speaker)) {
      const expired = payer && isLoginDriver(instance.driverKind) && host.engineLogins?.expired(payer, instance.driverKind);
      omit(expired ? "reconnect" : "credentials"); continue;
    }
    // A guest's turn on a Cloud home runs only on an engine that confines it.
    if (guestConfined && instance.adapter.capabilities.guestTurns !== "confined") { omit("capabilities"); continue; }
    const own = instance.instanceId === base?.instanceId;
    if (!own) {
      if (!base) { omit("capabilities"); continue; }
      if (modelSwitchNeedsAsk(mode, base.driverKind, instance.driverKind)) { omit("approval"); continue; }
      if (host.recoveryCapabilityError(
        { driverKind: base.driverKind, capabilities: base.adapter.capabilities },
        { driverKind: instance.driverKind, capabilities: instance.adapter.capabilities })) { omit("capabilities"); continue; }
      if (host.IDENTITY.kind === "perspicax") {
        if (instance.adapter.capabilities.withholdsHostTools !== true) { omit("capabilities"); continue; }
      } else if (host.engineProbes.get(instance.instanceId)?.ready !== true) {
        omit("offline"); continue;
      }
    }
    let via: AutoEngine["via"] = "server";
    if (host.IDENTITY.kind === "perspicax") {
      const plan = resolveEngineAccess(host.orgEngineInput(bot, instance, speaker));
      if (!plan.ok) {
        const expired = payer && isLoginDriver(instance.driverKind) && host.engineLogins?.expired(payer, instance.driverKind);
        omit(expired ? "reconnect" : "credentials"); continue;
      }
      via = plan.via;
    }
    // 2026-10-30 (lot 2): only models still on, for the organization and the bot's owner
    const switches = host.modelSwitchesFor(host.effectiveBotOwner(bot));
    for (const option of instance.models.options) {
      if (!modelOn(switches, instance.instanceId, option.id)) excluded?.push({ instanceId: instance.instanceId, engineLabel: host.engineDisplayName(instance), model: option.id, modelLabel: option.label || option.id, reason: "modelOff" });
    }
    const options = instance.models.options.filter((option) => !option.custom && modelOn(switches, instance.instanceId, option.id) &&
      (!host.hostedModels || host.hostedModels.allows({ instanceId: instance.instanceId, model: option.id })));
    // The bot's fast model (#1209): any row this engine lists, a local or
    // custom one included, when hosted models allow it.
    const fastWanted = bot.modelSelection.fast?.instanceId === instance.instanceId
      ? instance.models.options.find((option) => option.id === bot.modelSelection.fast?.model && modelOn(switches, instance.instanceId, option.id) &&
        (!host.hostedModels || host.hostedModels.allows({ instanceId: instance.instanceId, model: option.id })))
      : undefined;
    engines.push({
      instanceId: instance.instanceId,
      driverKind: instance.driverKind,
      displayName: host.engineDisplayName(instance),
      ...(fastWanted ? { fast: { id: fastWanted.id, label: fastWanted.label || fastWanted.id } } : {}),
      models: { default: instance.models.default, options },
      ...(instance.adapter.capabilities.effortLevels ? { effortLevels: instance.adapter.capabilities.effortLevels } : {}),
      via
    });
  }
  return engines;

}
  return autoEnginesFor;
}
