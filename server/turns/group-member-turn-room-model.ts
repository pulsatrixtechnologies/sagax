import { subagentTurnModel } from "../../shared/routine-model.ts";

/** #2038: a room member's Claude sub-agents run on the bot's fast model when
 * it is on the turn's engine (no routine model exists in a room). */
export function roomSubagentModel(bot: { modelSelection: { instanceId: string; fast?: { instanceId: string; model: string } } }, turnInstanceId: string): { subagentModel?: string } {
  const subagentModel = subagentTurnModel({ fast: bot.modelSelection.fast, turnInstanceId, botInstanceId: bot.modelSelection.instanceId });
  return subagentModel ? { subagentModel } : {};
}
