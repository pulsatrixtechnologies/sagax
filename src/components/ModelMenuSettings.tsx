// The settings of the model in use, under the composer's model list (the maintainer,
// 2026-10-13, after Cursor's model menu): Fast (only when the model has a
// fast twin) and Effort (only the levels this model takes,
// src/../shared/model-capabilities.ts). The maintainer, 2026-10-14: no Model › (the
// provider lists above already hold the engine's models) and no Context
// line (information, not a choice). #2963 (JC, 2026-11-08, "those dropdowns
// are hard to use"): Effort is a segmented control in line, Default then each
// level, one click, no list opened over the menu. The arrow keys move along it.
// Rendered by ModelPicker.tsx and ModelManager.tsx, which own what each choice does.
import { type KeyboardEvent, type ReactNode } from "react";

import type { EffortLevel } from "../../shared/wire";
import { isUltracodeEffort } from "../../shared/ultracode-effort";
import { cn } from "@/lib/cn";
import { effortLabel } from "@/lib/effort-label";
import { SWITCH_OFF, SWITCH_ON } from "@/lib/status-tones";
import { t } from "@/lib/i18n";

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
  disabled?: boolean;
}

const ROW = "flex w-full min-h-8 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-popover-ink outline-none hover:bg-popover-hover focus-visible:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";

export function ModelMenuSettings({ fast, effort, variantRow, disabled = false }: ModelMenuSettingsProps) {
  if (!fast && !effort && !variantRow) return null;
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
        <div data-model-settings-effort className="flex flex-col gap-1 px-2 py-1.5">
          <span className="text-[12px] text-popover-ink-secondary">{effort.title}</span>
          <EffortSegments {...effort} disabled={disabled} />
        </div>
      ))}
    </div>
  );
}

/** Default, then only the levels this model takes, side by side. A radio
 * group: the arrow keys move and pick, Home and End go to either end. */
export function EffortSegments({ title, levels, value, modelDefault, onPick, disabled = false, tone = "popover" }: {
  title: string;
  levels: readonly EffortLevel[];
  value?: EffortLevel;
  modelDefault?: EffortLevel;
  onPick: (level: EffortLevel | undefined) => void;
  disabled?: boolean;
  /** "popover" in the composer menu, "panel" in the models window. */
  tone?: "popover" | "panel";
}) {
  const choices: Array<EffortLevel | undefined> = [undefined, ...levels];
  const at = Math.max(0, choices.indexOf(value));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const to = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : step ? (at + step + choices.length) % choices.length : -1;
    if (to < 0) return;
    event.preventDefault();
    // stays inside the menu: its own arrow keys must not move the list too
    event.stopPropagation();
    onPick(choices[to]);
    const buttons = event.currentTarget.querySelectorAll<HTMLElement>("[data-model-effort-choice]");
    requestAnimationFrame(() => buttons[to]?.focus());
  };
  const panel = tone === "panel";
  return (
    <div role="radiogroup" aria-label={title} data-model-effort-menu onKeyDown={onKeyDown}
      className={cn("flex min-w-0 flex-wrap gap-0.5 rounded-lg p-0.5", panel ? "bg-inset" : "bg-popover-hover/60")}>
      {choices.map((level, index) => {
        const on = index === at;
        return (
          <button key={level ?? "default"} type="button" role="radio" aria-checked={on} disabled={disabled}
            tabIndex={on ? 0 : -1}
            data-model-effort-choice={level ?? "default"}
            title={level === undefined ? t("model.effort.defaultTitle") : isUltracodeEffort(level) ? t("model.effort.ultracodeHint") : t("model.effort.levelTitle", { level: effortLabel(level) })}
            onClick={() => onPick(level)}
            className={cn(
              "min-h-7 flex-1 whitespace-nowrap rounded-md px-2 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 motion-reduce:transition-none",
              on
                ? panel ? "bg-elevated font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "bg-popover font-medium text-popover-ink shadow-[0_1px_2px_rgb(0_0_0/0.18)]"
                : panel ? "text-ink-secondary hover:text-ink" : "text-popover-ink-secondary hover:text-popover-ink",
            )}>
            <span className={cn(isUltracodeEffort(level) && "ultracode-effort-option")}>
              {level === undefined
                ? modelDefault ? t("model.effort.defaultWith", { level: effortLabel(modelDefault) }) : t("model.defaultTag")
                : effortLabel(level)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
