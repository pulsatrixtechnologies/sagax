// The settings of the model in use, under the composer's model list (the maintainer,
// 2026-10-13, after Cursor's model menu): Fast (only when the model has a
// fast twin) and Effort (only the levels this model takes,
// src/../shared/model-capabilities.ts). The maintainer, 2026-10-14: no Model › (the
// provider lists above already hold the engine's models) and no Context
// line (information, not a choice). #4329 (owner, 2026-11-14, "too many
// options, too many buttons"): the effort is one line, "Thinking effort",
// with the level in use; it opens only the levels this model takes. Under
// it, "Runs with" says what runs the bot with this model, and is drawn only
// when more than one engine can. The models window keeps the segmented
// control (EffortSegments). Rendered by ModelPicker.tsx, which owns what
// each choice does.
import { useState, type ReactNode } from "react";

import type { EffortLevel } from "../../shared/wire";
import { isUltracodeEffort } from "../../shared/ultracode-effort";
import { cn } from "@/lib/cn";
import { effortLabel } from "@/lib/effort-label";
import { SWITCH_OFF, SWITCH_ON } from "@/lib/status-tones";
import { t } from "@/lib/i18n";
import { ChoiceLine, ROW } from "./MenuChoiceLine";
import { RunsWith, runsWithShown, type RunsWithChoice } from "./RunsWith";
import { ContextSize, contextSizeShown, type ContextSizeChoice } from "./ContextSize";
import { SegmentedChoice } from "./SegmentedChoice";

export type { ContextSizeChoice, RunsWithChoice };

export interface ModelMenuSettingsProps {
  /** The model has a fast twin: the switch, on while it runs the twin. */
  fast?: { on: boolean; onToggle: () => void };
  /** Its reasoning levels; absent when the model has no effort control. */
  effort?: {
    title: string;
    levels: readonly EffortLevel[];
    value?: EffortLevel;
    /** What runs when none is sent, when the engine says. */
    modelDefault?: EffortLevel;
    onPick: (level: EffortLevel | undefined) => void;
  };
  /** A row of its own instead of Effort (an engine with model variants). */
  variantRow?: ReactNode;
  /** "Runs with" (src/components/RunsWith.tsx): what runs the bot with
   * its model; the line is drawn only with two or more choices. */
  runsWith?: readonly RunsWithChoice[];
  /** #4417: "Context size" (src/components/ContextSize.tsx): the size the
   * bot's model runs at, where it offers more than one. */
  contextSize?: readonly ContextSizeChoice[];
  disabled?: boolean;
}


/** The word for "no level sent": the model's own default, when known. */
function defaultWord(modelDefault?: EffortLevel): string {
  return modelDefault ? t("model.effort.defaultWith", { level: effortLabel(modelDefault) }) : t("model.defaultTag");
}

export function ModelMenuSettings({ fast, effort, variantRow, runsWith, contextSize, disabled = false }: ModelMenuSettingsProps) {
  const [open, setOpen] = useState<"effort" | "runsWith" | "contextSize" | null>(null);
  const shownRunsWith = runsWith && runsWithShown(runsWith) ? runsWith : undefined;
  const shownContextSize = contextSize && contextSizeShown(contextSize) ? contextSize : undefined;
  if (!fast && !effort && !variantRow && !shownRunsWith && !shownContextSize) return null;
  const toggle = (line: "effort" | "runsWith" | "contextSize") => setOpen((current) => (current === line ? null : line));
  return (
    <div data-model-settings role="group" aria-label={t("model.settings.aria")} className="border-t border-popover-hairline px-1.5 py-1">
      {fast && (
        <button type="button" role="switch" aria-checked={fast.on} data-model-settings-fast disabled={disabled}
          title={t("model.settings.fastHint")} onClick={fast.onToggle} className={ROW}>
          <span>{t("model.fastTag")}</span>
          <span aria-hidden="true" className={cn("relative h-5 w-8 shrink-0 rounded-full transition-colors", fast.on ? SWITCH_ON : SWITCH_OFF)}>
            <span className={cn("absolute top-[2px] size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-[left]", fast.on ? "left-[14px]" : "left-[2px]")} />
          </span>
        </button>
      )}
      {variantRow ?? (effort && (
        <div data-model-settings-effort>
          <ChoiceLine label={t("model.thinkingEffort")} value={effort.value ? effortLabel(effort.value) : defaultWord(effort.modelDefault)}
            open={open === "effort"} disabled={disabled} onToggle={() => toggle("effort")}
            choices={[undefined, ...effort.levels].map((level) => ({
              key: level ?? "default",
              label: level === undefined ? defaultWord(effort.modelDefault) : effortLabel(level),
              title: level === undefined ? t("model.effort.defaultTitle") : isUltracodeEffort(level) ? t("model.effort.ultracodeHint") : t("model.effort.levelTitle", { level: effortLabel(level) }),
              ultracode: isUltracodeEffort(level),
              current: level === effort.value || (level === undefined && (effort.value === undefined || !effort.levels.includes(effort.value))),
              onPick: () => {
                effort.onPick(level);
                setOpen(null);
              },
            }))}
            dataName="effort" />
        </div>
      ))}
      {shownContextSize && (
        <ContextSize tone="menu" choices={shownContextSize} disabled={disabled}
          open={open === "contextSize"} onToggle={() => toggle("contextSize")} onPicked={() => setOpen(null)} />
      )}
      {shownRunsWith && (
        <RunsWith tone="menu" choices={shownRunsWith} disabled={disabled}
          open={open === "runsWith"} onToggle={() => toggle("runsWith")} onPicked={() => setOpen(null)} />
      )}
    </div>
  );
}

/** Default, then only the levels this model takes, side by side: the shared
 * segmented control (SegmentedChoice), in balanced lines past four. A radio
 * group: the arrow keys move and pick, Home and End go to either end. */
export function EffortSegments({ title, levels, value, modelDefault, onPick, disabled = false }: {
  title: string;
  levels: readonly EffortLevel[];
  value?: EffortLevel;
  modelDefault?: EffortLevel;
  onPick: (level: EffortLevel | undefined) => void;
  disabled?: boolean;
}) {
  const choices: Array<EffortLevel | undefined> = [undefined, ...levels];
  return (
    <SegmentedChoice<EffortLevel | "default"> data-model-effort-menu="" label={title} disabled={disabled}
      value={value && levels.includes(value) ? value : "default"}
      onPick={(key) => onPick(key === "default" ? undefined : key)}
      options={choices.map((level) => ({
        value: level ?? "default",
        title: level === undefined ? t("model.effort.defaultTitle") : isUltracodeEffort(level) ? t("model.effort.ultracodeHint") : t("model.effort.levelTitle", { level: effortLabel(level) }),
        data: { "data-model-effort-choice": level ?? "default" },
        label: (
          <span className={isUltracodeEffort(level) ? "ultracode-effort-option" : undefined}>
            {level === undefined ? defaultWord(modelDefault) : effortLabel(level)}
          </span>
        ),
      }))} />
  );
}
