// Composer modes (#4900), in the person's words: the names, the one-line
// blurbs and the line a side tooltip shows ("Quick responses · Grok 4.7").
// The rules and the choosing are server/models/model-mode.ts; the shared
// shapes are shared/model-mode.ts.
import { t } from "@/lib/i18n";
import {
  FORCED_MODEL_MODES, MODEL_MODES,
  type ForcedModelMode, type ModeResolution, type ModelMode,
} from "../../shared/model-mode";

export { FORCED_MODEL_MODES, MODEL_MODES, modeOfSelection, selectionForMode, type ModelMode, type ForcedModelMode } from "../../shared/model-mode";

export function modeName(mode: ModelMode): string {
  switch (mode) {
    case "auto": return t("model.mode.auto.name");
    case "fast": return t("model.mode.fast.name");
    case "expert": return t("model.mode.expert.name");
    case "heavy": return t("model.mode.heavy.name");
    case "build": return t("model.mode.build.name");
  }
}

/** What the mode does, in a few words. */
export function modeBlurb(mode: ModelMode): string {
  switch (mode) {
    case "auto": return t("model.mode.auto.blurb");
    case "fast": return t("model.mode.fast.blurb");
    case "expert": return t("model.mode.expert.blurb");
    case "heavy": return t("model.mode.heavy.blurb");
    case "build": return t("model.mode.build.blurb");
  }
}

/** The models behind a mode, as one line: one name, or the team's distinct
 * names (Heavy with several providers). Null for Auto, which reads each
 * request, and for a mode with nothing usable. */
export function modeModelsLine(mode: ModelMode, resolution: ModeResolution | undefined): string | null {
  if (mode === "auto" || !resolution?.pick) return null;
  const names = resolution.team?.length ? resolution.team.map((agent) => agent.modelLabel) : [resolution.pick.modelLabel];
  return [...new Set(names)].join(", ");
}

/** The side tooltip's line: what it does, then which model backs it. */
export function modeTooltip(mode: ModelMode, resolution: ModeResolution | undefined): string {
  const models = modeModelsLine(mode, resolution);
  return models ? t("model.mode.tip", { what: modeBlurb(mode), models }) : modeBlurb(mode);
}

/** The modes the person is offered: Auto always, the others only with a model
 * they can use (a choice that cannot work is not shown). Before the server
 * has answered every mode shows. */
export function offeredModes(resolutions: Record<ModelMode, ModeResolution> | undefined): ModelMode[] {
  return MODEL_MODES.filter((mode) => mode === "auto" || !resolutions || Boolean(resolutions[mode]?.pick));
}

/** "Expert · Grok 4.7" on a surface that has room for the model. */
export function modeChipLabel(mode: ModelMode, modelLabel: string | undefined): string {
  return modelLabel ? t("model.mode.chip", { mode: modeName(mode), model: modelLabel }) : modeName(mode);
}

export function isForcedMode(mode: ModelMode | null): mode is ForcedModelMode {
  return mode !== null && (FORCED_MODEL_MODES as readonly string[]).includes(mode);
}
