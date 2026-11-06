// @ts-nocheck
/** relayEnginesFor (#1388). Pure move from server/index.ts. */
import { modelOn } from "../../shared/offered-models.ts";
export type Host = Record<string, any>;

export function createRelayEnginesFor(getHost: () => Host): any {
function relayEnginesFor(bot: BotRecord, speaker: TurnSpeaker, guestConfined = false) {
  const host = getHost();
  const { resolveEngineAccess, secondLoginSupported } = host;

  const engines: AutoEngine[] = [];
  for (const instance of host.registry.instances()) {
    if (!instance.enabled || host.providerInstancesChanging.has(instance.instanceId) || host.policyModelRefusal(instance)) continue;
    if (host.orgEngineTurnRefusal(bot, instance, speaker)) continue;
    if (guestConfined && instance.adapter.capabilities.guestTurns !== "confined") continue;
    let via: AutoEngine["via"] = "server";
    const switches = host.modelSwitchesFor(host.effectiveBotOwner(bot));
    const options = instance.models.options.filter((option) => modelOn(switches, instance.instanceId, option.id) && (!host.hostedModels || host.hostedModels.allows({ instanceId: instance.instanceId, model: option.id })));
    const entry = (patch: Partial<AutoEngine> = {}): AutoEngine => ({
      instanceId: instance.instanceId,
      driverKind: instance.driverKind,
      displayName: host.engineDisplayName(instance),
      models: { default: instance.models.default, options },
      ...(instance.adapter.capabilities.effortLevels ? { effortLevels: instance.adapter.capabilities.effortLevels } : {}),
      via,
      ...patch
    });
    if (host.IDENTITY.kind === "perspicax") {
      if (instance.adapter.capabilities.withholdsHostTools !== true) continue;
      // 2026-10-29: the payer's second sign-in on this engine (their other
      // Grok account) is an engine of its own to run_with_engine, named by
      // what it is ("Grok (personal account)"); each is reached on its own
      // sign-in folder, never on the other's.
      const payer = host.turnPayerPrincipal(bot, instance, speaker);
      const second = secondLoginSupported(instance.driverKind) && payer && (host.engineLogins?.signedIn(payer, instance.driverKind, "second", instance.instanceId) ?? false)
        ? resolveEngineAccess(host.orgEngineInput(bot, instance, speaker, "second"))
        : null;
      const plan = resolveEngineAccess(host.orgEngineInput(bot, instance, speaker, "primary"));
      if (plan.ok) {
        via = plan.via;
        const kind = second?.ok ? host.grokAccountKindFor(payer, "primary", instance.instanceId) : undefined;
        engines.push(entry(kind ? { accountKind: kind } : {}));
      }
      if (second?.ok && second.via === "subscription") {
        const kind = host.grokAccountKindFor(payer, "second", instance.instanceId);
        engines.push(entry({ via: "subscription", displayName: host.relayAccountLabel(host.engineDisplayName(instance), kind), account: "second", ...(kind ? { accountKind: kind } : {}) }));
      }
      continue;
    } else if (host.engineProbes.get(instance.instanceId)?.ready === false) continue;
    engines.push(entry());
  }
  return engines;

}
  return relayEnginesFor;
}
