// @ts-nocheck
/** applyModelSwitches (#1388). Pure move from server/index.ts. */
import { orgEngineMoveLine } from "../../shared/offered-engines.ts";
import { modelOn } from "../../shared/offered-models.ts";
export type Host = Record<string, any>;

export function createApplyModelSwitches(getHost: () => Host): any {
function applyModelSwitches(owner?: string) {
  const host = getHost();
  const { modelOffer } = host;

  for (const { id } of host.store.bots) {
    const bot = host.store.bot(id);
    if (!bot) continue;
    const botOwner = host.effectiveBotOwner(bot);
    if (owner !== undefined && botOwner !== owner) continue;
    const switches = host.modelSwitchesFor(botOwner);
    const selection = bot.modelSelection;
    const withoutDisabledFast = (value: ModelSelection): ModelSelection => {
      if (!value.fast || modelOn(switches, value.fast.instanceId, value.fast.model)) return value;
      const { fast: _fast, ...rest } = value;
      return rest;
    };
    const cleaned = withoutDisabledFast(selection);
    if (cleaned !== selection) host.store.applyModelDefault(id, cleaned);
    const offer = modelOffer(switches, selection.instanceId, selection.model);
    if (offer !== "on") {
      const live = host.registry.get(selection.instanceId);
      const next = live?.models.options.find((option) => !option.custom && modelOn(switches, selection.instanceId, option.id));
      // Auto can use another ready engine even when this engine has no
      // model left on. Its concrete selection is checked before dispatch.
      const model = next?.id ?? selection.model;
      host.store.applyModelDefault(id, { instanceId: selection.instanceId, model, auto: true });
      console.log(`[models] bot=${id} model ${selection.instanceId}/${selection.model} is turned off; now on Auto (${model})`);
      if (offer === "adminOff" && bot.threadId) {
        const move = { from: selection.model, to: host.orgEngineName(selection.instanceId) };
        host.store.appendMessage(bot.threadId, { role: "bot", kind: "activity", tool: { name: `notice: ${orgEngineMoveLine(move)}`, ok: true, engineMove: move } });
      }
    }
    for (const task of host.store.bot(id)?.tasks ?? []) {
      if (!task.modelSelection) continue;
      const cleanedTask = withoutDisabledFast(task.modelSelection);
      if (cleanedTask !== task.modelSelection) host.store.patchTask(id, task.threadId, { modelSelection: cleanedTask });
    }
    const stray = (host.store.bot(id)?.tasks ?? [])
      .filter((task) => task.modelSelection && !modelOn(switches, task.modelSelection.instanceId, task.modelSelection.model))
      .map((task) => task.threadId);
    if (stray.length) host.store.followBotModel(id, stray, (from, to) => host.hostedModels?.resetTask(from, to) ?? {});
  }

}
  return applyModelSwitches;
}
