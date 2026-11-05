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
  return keys.length > 0 && keys.every(key => key === "model" || key === "subagentModel" || key === "effort");
}

export interface SubagentModelTurn {
  /** The routine's own sub-agent model (RoutineRun.subagentModel). */
  routineSubagentModel?: string;
  /** The routine model this turn already runs on (applied, not just saved). */
  routineModel?: string;
  /** The bot's fast model (ModelSelection.fast). */
  fast?: { instanceId: string; model: string };
  /** The engine this turn resolved to. */
  turnInstanceId: string;
  /** The engine the bot itself is on (its profile, not the thread). */
  botInstanceId: string;
  /** A usage-limit takeover moved this thread: nothing applies. */
  takenOver?: boolean;
  /** The models the turn's engine lists; empty when not known yet. */
  offered?: readonly string[];
  /** Why a model cannot be used (turned off by the organization or person). */
  refusal?: (model: string) => string | undefined;
}

/** The model a Claude turn's sub-agents run on (CLAUDE_CODE_SUBAGENT_MODEL),
 * or undefined (they inherit the turn's model). Precedence: the routine's
 * subagentModel, then the routine model, then the bot's fast model when it
 * is on the turn's own engine. The main turn's model is never touched. */
export function subagentTurnModel(turn: SubagentModelTurn): string | undefined {
  if (turn.takenOver) return undefined;
  if (turn.routineSubagentModel && turn.turnInstanceId === turn.botInstanceId) {
    const model = turn.routineSubagentModel;
    const listed = !turn.offered?.length || turn.offered.includes(model);
    if (listed && !turn.refusal?.(model)) return model;
  }
  if (turn.routineModel) return turn.routineModel;
  const fast = turn.fast;
  if (fast && fast.model && fast.instanceId === turn.turnInstanceId && !turn.refusal?.(fast.model)) return fast.model;
  return undefined;
}
