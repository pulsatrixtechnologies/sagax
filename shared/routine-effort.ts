import { isEffortLevel, type EffortLevel } from "./model-selection.ts";
import { effortAcceptedByModel, type ModelEffortFacts } from "./model-capabilities.ts";

export const ROUTINE_EFFORT_INVALID = "Choose a reasoning effort level, or null for the bot's effort.";

/** Omitted, null or empty means the bot's effort. Updates preserve omissions. */
export function parseRoutineEffort(value: unknown): { ok: true; effort?: EffortLevel } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true };
  if (!isEffortLevel(value)) return { ok: false, error: ROUTINE_EFFORT_INVALID };
  return { ok: true, effort: value };
}

export function loadRoutineEffort(value: unknown): EffortLevel | undefined {
  const parsed = parseRoutineEffort(value);
  return parsed.ok ? parsed.effort : undefined;
}

/** A takeover or a different engine wins, just as for the routine model. */
export function routineTurnEffort(turn: {
  effort?: EffortLevel;
  botInstanceId: string;
  turnInstanceId: string;
  takenOver: boolean;
  option?: ModelEffortFacts;
  levels?: readonly EffortLevel[];
}): { effort: EffortLevel } | { ignored: string } | null {
  if (!turn.effort || turn.takenOver || turn.botInstanceId !== turn.turnInstanceId) return null;
  if (!effortAcceptedByModel(turn.effort, turn.option, turn.levels)) {
    return { ignored: `Routine effort ${turn.effort} is not offered by this bot's engine for this model: this run uses the bot's effort.` };
  }
  return { effort: turn.effort };
}
