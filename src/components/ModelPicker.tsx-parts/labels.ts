// Chip and tooltip labels for ModelPicker (#1383).
import type { InstanceInfo, ModelSelection } from "@/state/store";
import { autoChipLabel, autoReasonSentence } from "@/lib/auto-model";
import type { AutoModelRecord } from "../../../shared/auto-model";
import { effortLabel } from "@/lib/effort-label";
import { t } from "@/lib/i18n";
import { modelLabel, modelProvider } from "./helpers";

export function modelPickerSummary(opts: {
  autoOn: boolean;
  autoRecord: AutoModelRecord | null | undefined;
  active: InstanceInfo | undefined;
  selection: ModelSelection;
  selectedVariantLabel: string | undefined;
  advanced: boolean;
}): string {
  const { autoOn, autoRecord, active, selection, selectedVariantLabel, advanced } = opts;
  if (autoOn) return autoRecord ? autoReasonSentence(autoRecord) : autoChipLabel(null);
  if (!active) return selection.model;
  return `${active.displayName} · ${modelLabel(active, selection.model)}${
    modelProvider(active, selection.model) ? ` · ${modelProvider(active, selection.model)}` : ""
  }${selectedVariantLabel ? ` · ${selectedVariantLabel}` : advanced && selection.effort ? ` · ${t("model.effort.summary", { level: effortLabel(selection.effort) })}` : ""}`;
}

export function modelPickerComposerLabel(opts: {
  autoOn: boolean;
  autoRecord: AutoModelRecord | null | undefined;
  active: InstanceInfo | undefined;
  selection: ModelSelection;
  selectedVariantLabel: string | undefined;
}): string {
  const { autoOn, autoRecord, active, selection, selectedVariantLabel } = opts;
  if (autoOn) return autoChipLabel(autoRecord);
  return [
    modelLabel(active, selection.model),
    selectedVariantLabel,
    !selectedVariantLabel && selection.effort ? effortLabel(selection.effort) : "",
  ].filter(Boolean).join(" ");
}

export function modelPickerFollowLine(opts: {
  follows: boolean | undefined;
  profileName: string;
  fallbackLine: string;
}): string {
  const { follows, profileName, fallbackLine } = opts;
  return (follows === true ? `\n${t("model.followsBot", { name: profileName })}` : follows === false ? `\n${t("model.ownModel")}` : "") + fallbackLine;
}

export function modelPickerEffectLine(opts: {
  effectAuto: boolean;
  orgMode: boolean;
  personalSettings: boolean | undefined;
  allowedEngines: unknown;
  effectName: string;
  provider: string;
}): string {
  const { effectAuto, orgMode, personalSettings, allowedEngines, effectName, provider } = opts;
  if (effectAuto) return t("model.effect.auto");
  if (orgMode || personalSettings === true || allowedEngines !== undefined) {
    return t("model.effect.model.pending", { model: effectName, provider });
  }
  return t("model.effect.model", { model: effectName, provider, payer: t("model.effect.payer.me") });
}
