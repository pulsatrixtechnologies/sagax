// Composer modes (#4900), in the person's words: the names, the one-line
// blurbs and the line a side tooltip shows ("Quick responses · Grok 4.7").
// The rules and the choosing are server/models/model-mode.ts; the shared
// shapes are shared/model-mode.ts.
import { t } from "@/lib/i18n";
import { effortLabel } from "@/lib/effort-label";
import type { EffortLevel, ModelSelection } from "../../shared/model-selection";
import {
  FORCED_MODEL_MODES, MODEL_MODES, modeOfSelection,
  type ForcedModelMode, type ModeResolution, type ModelMode,
} from "../../shared/model-mode";

export { FORCED_MODEL_MODES, MODEL_MODES, modeOfSelection, selectionForMode, type ModelMode, type ForcedModelMode } from "../../shared/model-mode";

export function modeName(mode: ModelMode): string {
  switch (mode) {
    // Build left the menu (M-20261125-073): what is still set on it reads as Auto
    case "build":
    case "auto": return t("model.mode.auto.name");
    case "fast": return t("model.mode.fast.name");
    case "expert": return t("model.mode.expert.name");
    case "heavy": return t("model.mode.heavy.name");
  }
}

/** What the mode does, in a few words. */
export function modeBlurb(mode: ModelMode): string {
  switch (mode) {
    case "build":
    case "auto": return t("model.mode.auto.blurb");
    case "fast": return t("model.mode.fast.blurb");
    case "expert": return t("model.mode.expert.blurb");
    case "heavy": return t("model.mode.heavy.blurb");
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

/** The chat bar's modes on the desktop (owner 2026-11-25, M-20261125-073,
 * M-20261125-075): Build left the menu. The shared list (shared/mode-menu.ts,
 * the console's copy) still names it for the surfaces that have not moved. */
export const CHAT_BAR_MODES: readonly ModelMode[] = MODEL_MODES.filter((mode) => mode !== "build");

/** The modes the person is offered: Auto always, the others only with a model
 * they can use (a choice that cannot work is not shown). Before the server
 * has answered every mode shows. */
export function offeredModes(resolutions: Record<ModelMode, ModeResolution> | undefined): ModelMode[] {
  return CHAT_BAR_MODES.filter((mode) => mode === "auto" || !resolutions || Boolean(resolutions[mode]?.pick));
}

/** The mode a selection reads as in the chat bar: one still set on Build
 * reads (and runs, server/index-leaves/autoPickForTurn.ts) as Auto; nothing
 * stored is rewritten. Null for a model the person pinned. */
export function shownMode(selection: Pick<ModelSelection, "auto" | "mode"> | undefined): ModelMode | null {
  const mode = modeOfSelection(selection);
  return mode === "build" ? "auto" : mode;
}

/** The chip under the message box (M-20261125-074): the mode, then the
 * reasoning level in use ("Expert · High"). Auto reads alone until the person
 * chooses a level (D-20261124-022); a level not known yet is never guessed. */
export function chatBarChipLabel(mode: ModelMode, level: EffortLevel | undefined): string {
  return level ? t("model.mode.chipLevel", { mode: modeName(mode), level: effortLabel(level) }) : modeName(mode);
}

/** "Expert · Grok 4.7" on a surface that has room for the model. */
export function modeChipLabel(mode: ModelMode, modelLabel: string | undefined): string {
  return modelLabel ? t("model.mode.chip", { mode: modeName(mode), model: modelLabel }) : modeName(mode);
}

export function isForcedMode(mode: ModelMode | null): mode is ForcedModelMode {
  return mode !== null && (FORCED_MODEL_MODES as readonly string[]).includes(mode);
}
