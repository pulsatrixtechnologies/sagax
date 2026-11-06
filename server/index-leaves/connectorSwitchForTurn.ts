// @ts-nocheck
/** connectorSwitchForTurn (#1388). Pure move from server/index.ts. */
import { pickConnectorSwitch } from "../connector-switch.ts";
export type Host = Record<string, any>;

export function createConnectorSwitchForTurn(getHost: () => Host): any {
function connectorSwitchForTurn(bot: BotRecord, threadId: string, speaker: TurnSpeaker, personText: string) {
  const host = getHost();
  const { approvalModeFor, modelSwitchNeedsAsk, secondLoginSupported } = host;
  if (process.env.SAGAX_CONNECTOR_SWITCH?.trim() === "0") return null;
  const need = host.connectorNeed(personText);
  if (!need) return null;
  const base = host.registry.get(bot.modelSelection.instanceId);
  if (!base) return null;
  const baseSlot = host.turnSlotFor(bot, base);
  const basePayer = host.IDENTITY.kind === "perspicax" ? host.turnPayerPrincipal(bot, base, speaker) : "";
  const current: SwitchEngine = {
    instanceId: base.instanceId, engineLabel: host.engineDisplayName(base), models: [], reach: host.engineReachFor(bot, base, speaker),
    ...(baseSlot === "second" ? { account: "second" as const } : {}),
    ...(basePayer && secondLoginSupported(base.driverKind) ? ((kind) => kind ? { accountKind: kind } : {})(host.grokAccountKindFor(basePayer, baseSlot)) : {})
  };
  const priced = (engine: AutoEngine) => engine.models.options.map((option) => ({ id: option.id, ...((price) => price === undefined ? {} : { price })(host.catalogPrice(engine.driverKind, option.id)) }));
  const confined = host.cloudGuestDriven(threadId) || host.botmailConfined(threadId);
  const candidates: SwitchEngine[] = host.autoEnginesFor(bot, speaker, confined).flatMap((engine) => {
    const live = engine.instanceId === base.instanceId ? undefined : host.registry.get(engine.instanceId);
    if (!live) return [];
    return [{
      instanceId: engine.instanceId,
      engineLabel: engine.displayName,
      models: priced(engine),
      ...(engine.models.default ? { defaultModel: engine.models.default } : {}),
      ...(engine.effortLevels ? { effortLevels: engine.effortLevels } : {}),
      reach: host.engineReachFor(bot, live, speaker, engine.via as TurnAccess["via"])
    }];
  });
  // 2026-10-29: the person's other Grok sign-in (relayEnginesFor), on this
  // very engine too: a personal connector asked of the team account moves
  // to the personal one when that one is known to have it.
  if (host.IDENTITY.kind === "perspicax") {
    for (const engine of host.relayEnginesFor(bot, speaker, confined)) {
      const live = host.registry.get(engine.instanceId);
      if (!live || !secondLoginSupported(engine.driverKind)) continue;
      const slot: LoginSlot = engine.account === "second" ? "second" : "primary";
      if (engine.instanceId === base.instanceId && slot === baseSlot) continue;
      if (candidates.some((candidate) => candidate.instanceId === engine.instanceId && candidate.account === engine.account)) continue;
      if (engine.instanceId !== base.instanceId && modelSwitchNeedsAsk(approvalModeFor(bot), base.driverKind, engine.driverKind)) continue;
      candidates.push({
        instanceId: engine.instanceId,
        engineLabel: engine.displayName,
        models: priced(engine),
        ...(engine.models.default ? { defaultModel: engine.models.default } : {}),
        ...(engine.effortLevels ? { effortLevels: engine.effortLevels } : {}),
        reach: host.engineReachFor(bot, live, speaker, engine.via as TurnAccess["via"], slot),
        ...(engine.account ? { account: engine.account } : {}),
        ...(engine.accountKind ? { accountKind: engine.accountKind } : {})
      });
    }
  }
  const basePrice = host.catalogPrice(base.driverKind, bot.modelSelection.model);
  return pickConnectorSwitch({
    need, current, candidates,
    base: { model: bot.modelSelection.model, ...(basePrice !== undefined ? { price: basePrice } : {}), ...(bot.modelSelection.effort ? { effort: bot.modelSelection.effort } : {}) }
  });

}
  return connectorSwitchForTurn;
}
