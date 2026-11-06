// @ts-nocheck
/** speakerTurnSelection (#1388). Pure move from server/index.ts. */
import { pickEquivalentModel, tierOfModel } from "../models/model-auto.ts";
import { starredModelSelections } from "../models/default-model-selection.ts";
export type Host = Record<string, any>;

export function createSpeakerTurnSelection(getHost: () => Host): any {
function speakerTurnSelection(bot: BotRecord, speaker: TurnSpeaker) {
  const host = getHost();
  const { applyViewerModelOverride, isPrincipalId } = host;

  if (host.IDENTITY.kind !== "perspicax" || bot.modelSelection.auto === true || speaker.origin !== "person") return null;
  const person = speaker.principalId?.trim().toLowerCase() || "";
  const owner = host.effectiveBotOwner(bot).trim().toLowerCase();
  if (!person || !isPrincipalId(person)) return null;
  const requested = bot.modelSelection;
  const ownerSpeaks = person === owner;
  const effortOk = (level: EffortLevel, instanceId: string): boolean => {
    const levels = host.registry.get(instanceId)?.adapter.capabilities.effortLevels;
    return Array.isArray(levels) && host.effortAcceptedByEngine(level, levels);
  };
  const ownPick = ownerSpeaks ? undefined : applyViewerModelOverride(requested, host.viewerBotOverrideStore.getOne(person, bot.id), effortOk);
  return host.routeTurnModel({
    requested,
    ownerSpeaks,
    speakerPays: host.speakerPayerMode(bot, speaker) === "speaker",
    access: (selection) => {
      const instance = host.registry.get(selection.instanceId);
      if (!instance?.enabled || host.providerInstancesChanging.has(instance.instanceId) || host.policyModelRefusal(instance) || host.orgEngineTurnRefusal(bot, instance, speaker)) return false;
      if (host.hostedModels && !host.hostedModels.allows({ instanceId: instance.instanceId, model: selection.model })) return false;
      if (host.isDesktopInjectModel(selection.model) && !host.desktopLocalModels.available(person, selection.model)) return false;
      return !host.orgEngineRefusal(bot, instance, speaker, selection.model);
    },
    offered: (selection) => {
      const instance = host.registry.get(selection.instanceId);
      const ids = instance ? host.payerAccountModels(bot, instance, speaker) : null;
      return ids && host.hostedModels ? ids.filter((model) => host.hostedModels!.allows({ instanceId: selection.instanceId, model })) : ids;
    },
    exempt: (selection) => host.isDesktopInjectModel(selection.model)
      || host.piLocalModel(selection)
      || host.registry.get(selection.instanceId)?.models.options.find((option) => option.id === selection.model)?.custom === true,
    effortOn: (selection, model) => {
      const instance = host.registry.get(selection.instanceId);
      const levels = instance?.models.options.find((option) => option.id === model)?.effortLevels ?? instance?.adapter.capabilities.effortLevels ?? [];
      return selection.effort && host.effortAcceptedByEngine(selection.effort, levels) ? selection.effort : undefined;
    },
    ...(ownPick && ownPick !== requested ? { ownPick: { instanceId: ownPick.instanceId, model: ownPick.model, ...(ownPick.effort ? { effort: ownPick.effort } : {}) } } : {}),
    starred: starredModelSelections(host.userPreferenceStore.get(person).preferences["sagax.modelFavorites.v1"])
      .map((selection) => ({ instanceId: selection.instanceId, model: selection.model })),
    equivalent: () => {
      // The same tier on another engine this person can pay for (Auto's
      // table and candidates: the bot's approval level must hold there).
      const base = host.registry.get(requested.instanceId);
      const tier = (base ? tierOfModel(base.driverKind, requested.model) : null) ?? "top";
      const engines = host.autoEnginesFor(bot, speaker).flatMap((engine) => {
        if (engine.instanceId === requested.instanceId) return [];
        const offered = host.payerAccountModels(bot, { instanceId: engine.instanceId, driverKind: engine.driverKind }, speaker);
        if (!offered) return [engine];
        const options = engine.models.options.filter((option) => offered.includes(option.id));
        return options.length ? [{ ...engine, models: { ...engine.models, options } }] : [];
      });
      const pick = engines.length ? pickEquivalentModel({ base: concreteSelection(requested), engines, catalog: host.autoCatalogLookup }, tier) : null;
      return pick ? concreteSelection(pick.selection) : null;
    }
  });

}
  return speakerTurnSelection;
}
