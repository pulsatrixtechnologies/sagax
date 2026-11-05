/** 2026-11-04: a routine's own model. Its runs use it; ordinary chat keeps
 * the bot's model. On Claude, sub-agents follow resolveClaudeSubagentModel
 * (#2038): this model, else the bot's fast model, else today's behaviour.
 * Only a model of the bot's own engine applies: anything else is ignored
 * at run start with one line in the run. A limit takeover wins over it. */

/** Model ids are free-form at the API boundary (custom engines accept ids
 * outside their catalog), so this only bounds the shape. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,199}$/;

export const ROUTINE_MODEL_INVALID = "A routine model is a model id of the bot's engine, at most 200 characters.";

/** null, "" or omitted: the bot's model. */
export function parseRoutineModel(value: unknown): { ok: true; model?: string } | { ok: false; error: string } {
  if (value == null) return { ok: true };
  if (typeof value !== "string") return { ok: false, error: ROUTINE_MODEL_INVALID };
  const model = value.trim();
  if (!model) return { ok: true };
  if (!MODEL_ID.test(model)) return { ok: false, error: ROUTINE_MODEL_INVALID };
  return { ok: true, model };
}

/** A persisted value that no longer reads is dropped (the bot's model). */
export function loadRoutineModel(value: unknown): string | undefined {
  const parsed = parseRoutineModel(value);
  return parsed.ok ? parsed.model : undefined;
}

export interface RoutineModelTurn {
  /** The run's routine model (RoutineRun.model). */
  model: string | undefined;
  /** The engine the bot itself is on (its profile, not the thread). */
  botInstanceId: string;
  /** The engine this turn resolved to. */
  turnInstanceId: string;
  /** A usage-limit takeover moved this thread: it wins. */
  takenOver: boolean;
  /** The models the turn's engine lists; empty when not known yet. */
  offered: readonly string[];
  /** The organization or the person turned this model off. */
  refusal?: string;
}

/** What the routine model does for this turn: run on it, nothing (no
 * model, or a takeover), or be ignored with the line the run shows. */
export function routineTurnModel(turn: RoutineModelTurn): { model: string } | { ignored: string } | null {
  const model = turn.model;
  if (!model || turn.takenOver) return null;
  if (turn.turnInstanceId !== turn.botInstanceId) return null;
  if (turn.refusal) return { ignored: `Routine model ${model} is not used: ${turn.refusal} This run uses the bot's model.` };
  if (turn.offered.length && !turn.offered.includes(model)) {
    return { ignored: `Routine model ${model} is not offered by this bot's engine: this run uses the bot's model.` };
  }
  return { model };
}

/** These settings change compute, never the routine's execution access. */
export function routineExecutionSettingsOnly(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(key => key === "model" || key === "effort" || key === "subagentModel");
}
