// The one look of every interactive question (JC 2026-10-20, from his
// capture): under the bot's bubble, a separate card in the bubble's own fill,
// 16px corners and padding, the question in bold, then one row per answer: a
// small rounded key (A, B, C) and the label in plain text. No outline, no
// filled buttons, no header. A row lights up under the pointer and a click is
// the answer. Choose-several questions draw a box instead of the key; a
// question in words draws one plain field. Once answered the card stays, the
// chosen row marked and the others dimmed.
//
// Used by QuestionCard (AskUserQuestion and the engines' asks), OptionCard
// (ask_person and the bots' flat asks, in a chat, a room or a bot-to-bot
// thread) and the Approvals screen through QuestionCard. iOS draws the same
// card in ios/App/Cards/QuestionSheet.swift.
import type { KeyboardEvent, ReactNode } from "react";
import { ArrowUp, Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { moveChoiceFocus } from "./AskCard";

/** The card's width follows a prose bubble's, so the two line up. */
export const QUESTION_SHEET_WIDTH = "w-full max-w-[min(80%,560px,calc(100%-82px))]";

/** The key that picks row `index`: A, B, C… Latin in every locale, since it is a key. */
export function sheetKey(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Row index for a pressed key, or -1. Plain letters only. */
export function sheetIndexForKey(key: string, count: number): number {
  if (key.length !== 1) return -1;
  const index = key.toUpperCase().charCodeAt(0) - 65;
  return index >= 0 && index < count && index < 26 ? index : -1;
}

/** A, B, C pick a row from the card itself or a row. Never from a field, a
 * modifier chord or another control (a tab), where a letter does nothing. */
export function sheetKeyHandler(count: number, pick: (index: number) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    if (target.closest("button, a") && !target.closest("[data-ask-choice]")) return;
    const index = sheetIndexForKey(event.key, count);
    if (index < 0) return;
    event.preventDefault();
    pick(index);
  };
}

export function QuestionSheet({
  ariaLabel,
  title,
  meta,
  onDismiss,
  dismissLabel,
  onKeyDown,
  settled = false,
  tour,
  children,
}: {
  ariaLabel: string;
  title?: ReactNode;
  /** small trailing text on the title line ("1 of 2 answered") */
  meta?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  settled?: boolean;
  tour?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-ask-card={settled ? "settled" : "pending"}
      data-question-sheet=""
      data-tour={tour}
      // focusable so A, B, C work as soon as the card is clicked
      tabIndex={settled ? undefined : -1}
      onKeyDown={onKeyDown}
      className={cn(QUESTION_SHEET_WIDTH, "rounded-2xl bg-card p-4 text-start text-ink outline-none")}
    >
      {(title || meta || onDismiss) && (
        <div className="mb-2.5 flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 break-words text-[14px] font-semibold leading-5 text-ink">
            <bdi dir="auto">{title}</bdi>
          </div>
          {meta && <span className="shrink-0 pt-px text-[11.5px] tabular-nums text-ink-tertiary">{meta}</span>}
          {onDismiss && dismissLabel && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={dismissLabel}
              title={dismissLabel}
              className="-me-1.5 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/[0.07] hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export interface SheetChoice {
  label: string;
  description?: string;
  /** what `picked` and `onPick` speak of when it is not the label (the
   * "Other" row, whose label may match one of the bot's) */
  id?: string;
}

/**
 * Which labels an answer text names, and what is left over (an answer in
 * words). An answer joins several picks with ", ", and a label may itself
 * hold a comma, so the longest labels are matched first, each as a whole
 * segment.
 */
export function picksInAnswer(value: string, labels: readonly string[]): { picked: string[]; rest: string } {
  const text = value.trim();
  if (!text) return { picked: [], rest: "" };
  if (labels.includes(text)) return { picked: [text], rest: "" };
  let remaining = `, ${text}, `;
  const picked: string[] = [];
  for (const label of [...labels].sort((a, b) => b.length - a.length)) {
    const needle = `, ${label}, `;
    const at = remaining.indexOf(needle);
    if (at < 0) continue;
    picked.push(label);
    remaining = `${remaining.slice(0, at)}, ${remaining.slice(at + needle.length)}`;
  }
  const rest = remaining.replace(/^(, )+|(, )+$/g, "").trim();
  return { picked: labels.filter((label) => picked.includes(label)), rest };
}

/** The answers, one per line. `picked` marks rows; once `settled`, the
 * rows stop answering and every row but the picked ones is dimmed. */
export function SheetChoices({
  choices,
  picked,
  multi = false,
  settled = false,
  disabled = false,
  ariaLabel,
  onPick,
}: {
  choices: readonly SheetChoice[];
  picked: readonly string[];
  multi?: boolean;
  settled?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onPick: (label: string) => void;
}) {
  if (!choices.length) return null;
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label={ariaLabel} onKeyDown={moveChoiceFocus} className="-mx-2 flex flex-col gap-0.5">
      {choices.map((choice, index) => {
        const id = choice.id ?? choice.label;
        const on = picked.includes(id);
        return (
          <button
            key={`${index}-${id}`}
            type="button"
            data-ask-choice=""
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            aria-keyshortcuts={settled ? undefined : sheetKey(index)}
            disabled={settled || disabled}
            onClick={() => onPick(id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-[10px] px-2 py-[7px] text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default",
              settled
                ? on ? "bg-ink/[0.06]" : "opacity-45"
                : on ? "bg-ink/[0.07]" : "hover:bg-ink/[0.05]",
            )}
          >
            {multi ? <SheetBox on={on} /> : <SheetKey letter={sheetKey(index)} on={on} />}
            <span className="min-w-0 flex-1">
              {/* plaintext bidi: each label orders its own script */}
              <span className="block break-words text-[13.5px] leading-5 text-ink [unicode-bidi:plaintext]">{choice.label}</span>
              {choice.description && (
                <span className="block break-words text-[12.5px] leading-snug text-ink-secondary [unicode-bidi:plaintext]">{choice.description}</span>
              )}
            </span>
            {settled && on && <Check size={15} strokeWidth={2.4} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
          </button>
        );
      })}
    </div>
  );
}

/** The 22px key on a row: a slightly lighter square with a hairline. */
export function SheetKey({ letter, on, invalid = false }: { letter: string; on: boolean; invalid?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-md border text-[11.5px] font-medium leading-none transition-colors",
        on ? "border-ink/[0.28] bg-ink/[0.16] text-ink" : invalid ? "border-danger bg-ink/[0.06] text-ink-secondary" : "border-ink/[0.14] bg-ink/[0.06] text-ink-secondary",
      )}
    >
      {letter}
    </span>
  );
}

/** A choose-several row's box, in the key's 22px slot. */
export function SheetBox({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className="flex size-[22px] shrink-0 items-center justify-center">
      <span
        className={cn(
          "flex size-[18px] items-center justify-center rounded-[5px] border transition-colors",
          on ? "border-ink/[0.28] bg-ink/[0.16] text-ink" : "border-ink/[0.18] bg-ink/[0.06]",
        )}
      >
        {on && <Check size={12} strokeWidth={2.8} />}
      </span>
    </span>
  );
}

/** One plain field for an answer in words. Enter sends (Shift+Enter is a
 * new line); the small arrow sends too. It never takes focus on its own. */
export function SheetField({
  value,
  placeholder,
  ariaLabel,
  maxLength,
  canSend,
  sendLabel,
  onChange,
  onSend,
  className,
  fieldId,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  maxLength?: number;
  canSend: boolean;
  sendLabel: string;
  onChange: (value: string) => void;
  onSend: () => void;
  className?: string;
  /** marks the field so the "Other" row can hand it the focus */
  fieldId?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <textarea
        data-question-field={fieldId}
        dir="auto"
        rows={1}
        value={value}
        maxLength={maxLength}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (canSend) onSend();
        }}
        className="block max-h-40 min-h-9 w-full resize-none rounded-[10px] border border-ink/[0.12] bg-ink/[0.04] py-2 pe-10 ps-3 text-[13.5px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus:border-ink/[0.28] [field-sizing:content]"
      />
      {value.trim() && (
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={sendLabel}
          title={sendLabel}
          className="absolute bottom-1.5 end-1.5 flex size-6 items-center justify-center rounded-full bg-ink text-app transition-opacity hover:opacity-85 disabled:opacity-30"
        >
          <ArrowUp size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/** The quiet send for a choose-several question or a set: text, no fill. */
export function SheetSend({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <div className="mt-2.5 flex justify-end">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="h-7 rounded-full px-3 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-ink/[0.07] hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {label}
      </button>
    </div>
  );
}

/** A line under the rows: the answer given in words, or why the card closed. */
export function SheetNote({ children, closed = false }: { children: ReactNode; closed?: boolean }) {
  return (
    <div dir="auto" aria-live="polite" className="mt-2 flex items-start gap-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-snug text-ink-secondary">
      {closed ? <X size={13} className="mt-px shrink-0" aria-hidden="true" /> : <Check size={13} className="mt-px shrink-0" aria-hidden="true" />}
      <span className="min-w-0">{children}</span>
    </div>
  );
}
