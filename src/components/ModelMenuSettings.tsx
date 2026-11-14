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
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

import type { EffortLevel } from "../../shared/wire";
import { isUltracodeEffort } from "../../shared/ultracode-effort";
import { cn } from "@/lib/cn";
import { effortLabel } from "@/lib/effort-label";
import { SWITCH_OFF, SWITCH_ON } from "@/lib/status-tones";
import { t } from "@/lib/i18n";

/** One value of "Runs with": the engine that would run the model in use. */
export interface RunsWithChoice {
  key: string;
  /** The first-level word: "Its own tool", "pi", "OpenCode", "Built in". */
  label: string;
  /** One grey line in the opened list: the tool by its name, or what it is. */
  hint?: string;
  recommended?: boolean;
  current: boolean;
  onPick: () => void;
}

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
  /** The engines that can run the model in use; the line is drawn only
   * with two or more. */
  runsWith?: readonly RunsWithChoice[];
  disabled?: boolean;
}

const ROW = "flex w-full min-h-8 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-popover-ink outline-none hover:bg-popover-hover focus-visible:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";

/** The word for "no level sent": the model's own default, when known. */
function defaultWord(modelDefault?: EffortLevel): string {
  return modelDefault ? t("model.effort.defaultWith", { level: effortLabel(modelDefault) }) : t("model.defaultTag");
}

export function ModelMenuSettings({ fast, effort, variantRow, runsWith, disabled = false }: ModelMenuSettingsProps) {
  const [open, setOpen] = useState<"effort" | "runsWith" | null>(null);
  const runsWithShown = runsWith && runsWith.length > 1 ? runsWith : undefined;
  if (!fast && !effort && !variantRow && !runsWithShown) return null;
  const toggle = (line: "effort" | "runsWith") => setOpen((current) => (current === line ? null : line));
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
      {runsWithShown && (
        <div data-model-settings-runs-with>
          <ChoiceLine label={t("model.runsWith")} value={runsWithShown.find((choice) => choice.current)?.label ?? ""}
            open={open === "runsWith"} disabled={disabled} onToggle={() => toggle("runsWith")}
            choices={runsWithShown.map((choice) => ({
              key: choice.key,
              label: choice.recommended ? t("model.runsWith.recommended", { value: choice.label }) : choice.label,
              hint: choice.hint,
              current: choice.current,
              onPick: () => {
                if (!choice.current) choice.onPick();
                setOpen(null);
              },
            }))}
            dataName="runs-with" />
        </div>
      )}
    </div>
  );
}

interface LineChoice {
  key: string;
  label: string;
  hint?: string;
  title?: string;
  ultracode?: boolean;
  current: boolean;
  onPick: () => void;
}

/** One line, its value at the right; a click opens its choices under it,
 * each with a check on the one in use. The arrow keys move between them. */
function ChoiceLine({ label, value, open, disabled, onToggle, choices, dataName }: {
  label: string;
  value: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  choices: readonly LineChoice[];
  dataName: string;
}) {
  const listId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-model-line-choice]")];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const to = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + step + buttons.length) % buttons.length;
    event.preventDefault();
    // stays inside the menu: its own arrow keys must not move the list too
    event.stopPropagation();
    buttons[to]?.focus();
  };
  return (
    <>
      <button type="button" data-model-line={dataName} aria-expanded={open} aria-controls={listId} disabled={disabled}
        onClick={onToggle} className={ROW}>
        <span className="shrink-0">{label}</span>
        <span className="flex min-w-0 items-center gap-1 text-popover-ink-secondary">
          <span data-model-line-value className="truncate">{value}</span>
          {open ? <ChevronDown size={14} aria-hidden="true" className="shrink-0" /> : <ChevronRight size={14} aria-hidden="true" className="shrink-0" />}
        </span>
      </button>
      {open && (
        <div id={listId} role="group" aria-label={label} data-model-line-choices={dataName} onKeyDown={onKeyDown} className="pb-0.5">
          {choices.map((choice) => (
            <button key={choice.key} type="button" role="menuitemradio" aria-checked={choice.current} disabled={disabled}
              data-model-line-choice={choice.key} title={choice.title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={choice.onPick}
              className={cn(ROW, "pl-4")}>
              <span className="flex min-w-0 flex-col">
                <span className={cn("truncate", choice.ultracode && "ultracode-effort-option")}>{choice.label}</span>
                {choice.hint && <span data-model-line-hint className="text-[12px] leading-4 text-popover-ink-secondary">{choice.hint}</span>}
              </span>
              {choice.current && <Check size={14} aria-hidden="true" className="shrink-0 text-popover-accent" />}
            </button>
          ))}
        </div>
      )}
    </>
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
