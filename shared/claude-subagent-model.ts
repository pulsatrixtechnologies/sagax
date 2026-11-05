/** #2038: which model Claude sub-agents (Agent tool, Flow workers) run on.
 * Sets CLAUDE_CODE_SUBAGENT_MODEL. The main bot's reasoning model is
 * untouched. No blind default: absent inputs keep today's behaviour. */

export interface ClaudeSubagentModelInput {
  /** Per-routine override (Routine.subagentModel / RoutineRun.subagentModel). */
  routineSubagentModel?: string;
  /** Routine.model already applied to this turn (state.routineModel). */
  routineModel?: string;
  /** Bot modelSelection.fast (#1209). */
  fast?: { instanceId: string; model: string };
  /** Engine instance this turn resolved to. */
  turnInstanceId: string;
}

/**
 * Priority: per-routine subagentModel, then the routine's model, then the
 * bot's fast model when it runs on the same engine as the turn.
 */
export function resolveClaudeSubagentModel(input: ClaudeSubagentModelInput): string | undefined {
  if (input.routineSubagentModel) return input.routineSubagentModel;
  if (input.routineModel) return input.routineModel;
  const fast = input.fast;
  if (fast?.model && fast.instanceId === input.turnInstanceId) return fast.model;
  return undefined;
}
