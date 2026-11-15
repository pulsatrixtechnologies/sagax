// One line of the composer's model menu settings (ModelMenuSettings.tsx):
// its label, its value at the right; a click opens its choices under it,
// each with a check on the one in use, an optional grey line under each.
// Shared by "Thinking effort" and "Runs with" (src/components/RunsWith.tsx).
import { useId, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";

export const ROW = "flex w-full min-h-8 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-popover-ink outline-none hover:bg-popover-hover focus-visible:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";

export interface LineChoice {
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
export function ChoiceLine({ label, value, open, disabled, onToggle, choices, dataName }: {
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

