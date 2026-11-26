// Composer modes (#4900, back by #5088; owner 2026-11-23, M-20261123-045):
// the chat bar's menu, the same as the Perspicax console's: Auto, Fast,
// Expert, Heavy, then Reasoning, then All models (the person's own
// pinned model, no mode). The rows and their rules are shared/mode-menu.ts,
// the one definition for both products. A mode never names a model. Sagax maps it,
// every turn, to the best models the person can use (their connected
// providers and accounts, plus local models): the choosing is
// server/models/model-mode.ts, the words are in the renderer.
//
// A mode other than Auto rides the Auto flag (`auto: true` plus `mode`), so
// every path that already treats Auto (recovery, routines, hand-offs, a
// voice call turn) keeps working, and the same persistence carries it: the
// selection of the bot, or of a thread that picked its own.
import { HEAVY_MAX_EXPERTS } from "./heavy-team.ts";
import type { EffortLevel, ModelSelection } from "./model-selection.ts";
import { MENU_MODES, type MenuMode } from "./mode-menu.ts";

/** Build stopped everywhere (owner 2026-11-26, D-20261126-005): it is no mode
 * of Sagax any more. The server never picks it, answers it in no list and
 * stores it nowhere; a selection or a request that still names it is Auto.
 * shared/mode-menu.ts keeps the word only because that file is the console's
 * byte-identical copy. */
export const RETIRED_MODEL_MODE = "build";
export type ModelMode = Exclude<MenuMode, typeof RETIRED_MODEL_MODE>;
export const MODEL_MODES: readonly ModelMode[] = MENU_MODES.filter((mode): mode is ModelMode => mode !== RETIRED_MODEL_MODE);

/** The modes that pick a model by their own rule (everything but Auto). */
export type ForcedModelMode = Exclude<ModelMode, "auto">;
export const FORCED_MODEL_MODES: readonly ForcedModelMode[] = ["fast", "expert", "heavy"];

export function isModelMode(value: unknown): value is ModelMode {
  return typeof value === "string" && (MODEL_MODES as readonly string[]).includes(value);
}

export function isForcedModelMode(value: unknown): value is ForcedModelMode {
  return typeof value === "string" && (FORCED_MODEL_MODES as readonly string[]).includes(value);
}

/** The mode a selection is in: null for a model the person pinned. */
export function modeOfSelection(selection: Pick<ModelSelection, "auto" | "mode"> | undefined): ModelMode | null {
  if (!selection || selection.auto !== true) return null;
  return isForcedModelMode(selection.mode) ? selection.mode : "auto";
}

/** The selection a mode writes: the bot's own engine and fallback model stay
 * (a client or a path that does not know modes still runs a valid model), the
 * Auto flag goes on, the mode is stored for the ones that are not Auto, and
 * what only a pinned model or plain Auto carries (a variant, Auto's Optimize
 * choice) goes. The effort stays: Fast, Expert and Heavy set their own while
 * a turn runs, Auto runs the person's. */
export function selectionForMode(selection: ModelSelection, mode: ModelMode): ModelSelection {
  const { mode: _mode, variant: _variant, autoOptimize: _optimize, ...rest } = selection;
  return {
    ...rest,
    auto: true,
    ...(isForcedModelMode(mode) ? { mode } : { autoOptimize: selection.autoOptimize ?? "balance" }),
  };
}

/** One model a mode runs, as the person reads it. */
export interface ModeModel {
  instanceId: string;
  model: string;
  /** "Claude", "OpenAI", the server's name... */
  engineLabel: string;
  modelLabel: string;
}

/** What a mode runs for this person now (GET /api/bots/:id/auto-model). */
export interface ModeResolution {
  mode: ModelMode;
  /** The model that answers (Heavy: the Leader). Null when no model is usable. */
  pick: ModeModel | null;
  /** The reasoning level the mode asks for, when the engine offers one. */
  effort?: EffortLevel;
  /** Heavy: the seats its experts take (an account and a model each,
   * different accounts first), before the leader acts. */
  team?: ModeModel[];
}

/** Heavy: at most this many seats, as many as the most experts a team may
 * have (D-20261119-084, D-20261126-023: 2 to 8, shared/heavy-team.ts). */
export const HEAVY_MAX_AGENTS = HEAVY_MAX_EXPERTS;
