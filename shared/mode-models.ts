// The person's own modes (owner 2026-11-25, M-20261125-074, M-20261125-075,
// #5372): in Settings > Modes a person chooses the model (and the reasoning)
// Fast and Expert use, and Heavy's experts. Per person, never per
// organization, and without an admin. Kept beside the person's model
// switches (GET/PUT /api/me/models, `modeModels`) and read by each turn of
// their bots (server/models/model-mode.ts). While a person sets nothing
// every mode runs what Sagax resolves by itself (D-20261119-031); a choice
// that cannot run now (its engine gone, the model turned off or refused) is
// kept and the mode runs what it resolves by itself until it comes back.
// Auto has no setting: it reads each request.
import { isEffortLevel, type EffortLevel } from "./model-selection.ts";

/** Heavy: at most this many experts (shared/model-mode.ts, HEAVY_MAX_AGENTS). */
export const MODE_MAX_EXPERTS = 5;
const MAX_ID = 200;

export interface ModeModelChoice {
  instanceId: string;
  model: string;
  /** The reasoning level; absent: the mode's own. */
  effort?: EffortLevel;
}

export interface ModeModels {
  fast?: ModeModelChoice;
  expert?: ModeModelChoice;
  /** Heavy's experts, in the person's order. */
  heavy?: Array<Pick<ModeModelChoice, "instanceId" | "model">>;
}

export const SETTABLE_MODES = ["fast", "expert"] as const;
export type SettableMode = (typeof SETTABLE_MODES)[number];

const sane = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID;

function cleanChoice(raw: unknown, withEffort: boolean): ModeModelChoice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { instanceId, model, effort } = raw as Record<string, unknown>;
  if (!sane(instanceId) || !sane(model)) return null;
  return { instanceId, model, ...(withEffort && isEffortLevel(effort) ? { effort } : {}) };
}

/** The stored setting, well formed: anything else is dropped. */
export function cleanModeModels(raw: unknown): ModeModels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: ModeModels = {};
  for (const mode of SETTABLE_MODES) {
    const choice = cleanChoice(source[mode], true);
    if (choice) out[mode] = choice;
  }
  if (Array.isArray(source.heavy)) {
    const experts: NonNullable<ModeModels["heavy"]> = [];
    for (const entry of source.heavy) {
      const choice = cleanChoice(entry, false);
      if (choice && !experts.some((seat) => seat.instanceId === choice.instanceId && seat.model === choice.model)) experts.push(choice);
    }
    if (experts.length) out.heavy = experts.slice(0, MODE_MAX_EXPERTS);
  }
  return out;
}

export function modeModelsEmpty(value: ModeModels): boolean {
  return !value.fast && !value.expert && !value.heavy?.length;
}
