// @ts-nocheck
/** orgAdminSetModel (#5323): the console's "Change model" of a bot. Moved
 * from server/index.ts so its rules run under a test. `effort` is the bot's
 * reasoning level, checked and stored by checkedModelSelection like any model
 * selection; null takes the level off. A call that names no `effort` writes
 * the engine and the model alone, as before. */
import { ConsoleRefusal } from "../org/org-admin-console.ts";
export type Host = Record<string, any>;

export function createOrgAdminSetModel(getHost: () => Host): any {
function orgAdminSetModel(botId: string, input: { engineInstanceId?: string; model: string | null; effort?: string | null }): void {
  const host = getHost();
  const { store, registry } = host;
  const bot = store.bot(botId);
  if (!bot) throw new ConsoleRefusal(404, "not_found", "No such bot.");
  const instanceId = input.engineInstanceId ?? bot.modelSelection.instanceId;
  const entry = registry.entries().find((candidate) => candidate.instanceId === instanceId);
  if (!entry || !host.engineInstalled(instanceId)) throw new ConsoleRefusal(400, "engine_not_installed", `The engine ${instanceId} is not installed on this server.`);
  if (!host.consoleEngineAllowed(instanceId)) throw new ConsoleRefusal(400, "engine_not_allowed", `The organization's policy does not allow the engine ${instanceId}.`);
  if (bot.approvalGrant) throw new ConsoleRefusal(409, "busy", "Wait for the approval-level change to finish before changing models.");
  // null: the bot's model on the same engine, else the engine's default.
  const model = input.model ?? (instanceId === bot.modelSelection.instanceId ? bot.modelSelection.model : registry.get(instanceId)?.models.default ?? null);
  if (!model) throw new ConsoleRefusal(400, "bad_request", "This engine has no default model: choose one.");
  // A level alone (the bot's own engine and model) keeps the rest of the bot's
  // selection, as the composer's Reasoning row does; a level replaces a variant.
  const levelOnly = input.effort !== undefined && instanceId === bot.modelSelection.instanceId && model === bot.modelSelection.model;
  const { effort: _effort, variant: _variant, ...kept } = bot.modelSelection;
  const asked = input.effort === undefined
    ? { instanceId, model }
    : { ...(levelOnly ? kept : { instanceId, model }), ...(input.effort !== null ? { effort: input.effort } : {}) };
  const checked = host.checkedModelSelection(asked, { selection: bot.modelSelection, busy: host.threadBusy(bot.id, bot.threadId) }, true);
  if (!checked.ok) throw new ConsoleRefusal(checked.status, checked.status === 409 ? "busy" : "bad_request", checked.error);
  // checkedModelSelection drops a level the model does not take (a client from
  // before per-model levels); the console named this one, so it is told.
  if (typeof input.effort === "string" && checked.selection.effort !== input.effort) {
    throw new ConsoleRefusal(400, "effort_not_offered", `The model ${model} does not take the reasoning level "${input.effort}".`);
  }
  store.patchBot(bot.id, { modelSelection: checked.selection });
}
  return orgAdminSetModel;
}
