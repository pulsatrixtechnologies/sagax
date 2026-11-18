// #4711 (owner, 2026-11-17: "why it didn't switch model?"): a bot's
// background work runs on the model its chat chip shows. A proactive wake, a
// routine run or a webhook run works in a hidden task of its own; that task
// follows the bot's model, but the chip the person reads is the one of their
// conversation with the bot, which keeps its own model when they picked one
// there (shared/thread-model.ts). The run's task starts on that same model,
// so what the chip says is what runs. A routine with its own model keeps it
// (shared/routine-model.ts): the person chose it for that routine.
import type { ModelSelection } from "../../shared/wire.ts";

export interface RunTaskModelInput {
  /** The run's own routine model (RoutineRun.model), when it has one. */
  routineModel?: string;
  /** The person's conversation with the bot the run reports into: its own
   * model when the person picked one there, absent when it follows the bot. */
  conversation?: { modelSelection?: ModelSelection } | null;
}

/** The model a run's task starts on, or undefined when it follows the bot
 * (the store keeps no model for a task on its bot's own). */
export function runTaskModel(input: RunTaskModelInput): ModelSelection | undefined {
  if (input.routineModel?.trim()) return undefined;
  const own = input.conversation?.modelSelection;
  return own ? structuredClone(own) : undefined;
}
