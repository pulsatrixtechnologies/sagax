// The settings of the model in use, under the composer's model list (the maintainer,
// 2026-10-13, after Cursor's model menu): Fast (only when the model has a
// fast twin) and Effort › (only the levels this model takes,
// src/../shared/model-capabilities.ts). The maintainer, 2026-10-14: no Model › (the
// provider submenus above already list the engine's models) and no Context
// line (information, not a choice). Effort › opens its list over the whole
// menu; Escape, the left arrow or Back returns to these rows with the focus
// on Effort. Rendered by ModelPicker.tsx, which owns what each choice does.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

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

type View = "effort" | null;

const ROW = "flex w-full min-h-8 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-popover-ink outline-none hover:bg-popover-hover focus-visible:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";

export function ModelMenuSettings({ fast, effort, variantRow, disabled = false }: ModelMenuSettingsProps) {
  const [view, setView] = useState<View>(null);
  const effortRef = useRef<HTMLButtonElement>(null);
  const back = () => {
    setView(null);
    // the row that opened the list gets the focus back once it is drawn again
    requestAnimationFrame(() => effortRef.current?.focus());
  };

  if (!fast && !effort && !variantRow) return null;
  const effortValue = effort?.value ?? effort?.modelDefault;
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
        <button ref={effortRef} type="button" data-model-settings-effort disabled={disabled} aria-haspopup="menu" aria-expanded={view === "effort"}
          onClick={() => setView("effort")} className={ROW}>
          <span>{effort.title}</span>
          <span className="flex min-w-0 items-center gap-1 text-popover-ink-secondary">
            <span className={cn("truncate", isUltracodeEffort(effort.value) && "ultracode-effort-chip")}>
              {effortValue ? effortLabel(effortValue) : t("model.defaultTag")}
            </span>
            <ChevronRight size={14} aria-hidden="true" className="shrink-0" />
          </span>
        </button>
      ))}
      {view === "effort" && effort && (
        <EffortSubmenu {...effort} disabled={disabled} onBack={back}
          onPick={(level) => {
            effort.onPick(level);
            back();
          }} />
      )}
    </div>
  );
}

/** A list opened over the whole menu, with a way back. */
function Submenu({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div data-model-submenu className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-xl popover-surface bg-popover py-1"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onBack();
      }}>
      <button type="button" data-model-submenu-back onClick={onBack} aria-label={t("model.settings.back", { title })}
        className="mx-1.5 mb-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-popover-ink-secondary outline-none hover:bg-popover-hover hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus">
        <ChevronLeft size={14} aria-hidden="true" />
        <span>{title}</span>
      </button>
      <div className="flex min-h-0 flex-1 flex-col border-t border-popover-hairline pt-1">{children}</div>
    </div>
  );
}

/** Default, then only the levels this model takes; the arrow keys move,
 * Enter or Space picks, Escape and the left arrow go back. */
function EffortSubmenu({ title, levels, value, modelDefault, onPick, onBack, disabled }: {
  title: string;
  levels: readonly EffortLevel[];
  value?: EffortLevel;
  modelDefault?: EffortLevel;
  onPick: (level: EffortLevel | undefined) => void;
  onBack: () => void;
  disabled: boolean;
}) {
  const choices: Array<EffortLevel | undefined> = [undefined, ...levels];
  const listRef = useRef<HTMLDivElement>(null);
  const items = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  useEffect(() => {
    (items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at <= 0 ? all.length - 1 : at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(all.length - 1);
    else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onBack();
    }
  };
  return (
    <Submenu title={title} onBack={onBack}>
      <div ref={listRef} role="menu" aria-label={title} data-model-effort-menu onKeyDown={onKeyDown} className="overflow-y-auto px-1.5 pb-1">
        {choices.map((level) => {
          const on = value === level;
          return (
            <button key={level ?? "default"} type="button" role="menuitemradio" aria-checked={on} disabled={disabled}
              data-model-effort-choice={level ?? "default"}
              title={level === undefined ? t("model.effort.defaultTitle") : isUltracodeEffort(level) ? t("model.effort.ultracodeHint") : t("model.effort.levelTitle", { level: effortLabel(level) })}
              onClick={() => onPick(level)} className={ROW}>
              <span className={cn(isUltracodeEffort(level) && "ultracode-effort-option")}>
                {level === undefined
                  ? modelDefault ? t("model.effort.defaultWith", { level: effortLabel(modelDefault) }) : t("model.defaultTag")
                  : effortLabel(level)}
              </span>
              {on && <Check size={14} aria-hidden="true" className="shrink-0 text-popover-accent" />}
            </button>
          );
        })}
      </div>
    </Submenu>
  );
}
