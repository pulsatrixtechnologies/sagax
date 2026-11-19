// The one look of every interactive question (2026-10-20, from his
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
import { Fragment, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Box, Check, FileText, LayoutDashboard, Sparkles, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { CardCloseButton, moveChoiceFocus } from "./AskCard";
import { CardMarkdown } from "./CardMarkdown";

const CHOICE_ICONS: Record<string, LucideIcon> = {
  "file-text": FileText,
  "layout-dashboard": LayoutDashboard,
  sparkles: Sparkles,
  box: Box,
};

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
  embedded = false,
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
  /** inside another card (the pinned card over the composer, #3214): no
   * frame, no width cap of its own; the host card draws them */
  embedded?: boolean;
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
      className={cn("w-full", !embedded && "rounded-2xl bg-card p-3", "text-start text-ink outline-none")}
    >
      {(title || meta || onDismiss) && (
        <div className="mb-2.5 flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 break-words text-[14px] font-semibold leading-5 text-ink">
            <bdi dir="auto">{title}</bdi>
          </div>
          {meta && <span className="shrink-0 pt-px text-[11.5px] tabular-nums text-ink-tertiary">{meta}</span>}
          {onDismiss && dismissLabel && <CardCloseButton label={dismissLabel} onClick={onDismiss} className="-mt-1" />}
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
  /** Optional lucide icon key drawn beside the label (#2048 page targets). */
  icon?: string;
  /** Greyed row the person cannot pick. */
  disabled?: boolean;
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
  quietPicked = false,
  keys = "letters",
  after,
  ariaLabel,
  onPick,
}: {
  choices: readonly SheetChoice[];
  picked: readonly string[];
  multi?: boolean;
  settled?: boolean;
  disabled?: boolean;
  /** #4490: a checklist's rows: the box says it all, no tint and no
   * trailing check on a checked row */
  quietPicked?: boolean;
  /** #4910: the key on each row: letters (A, B, C), numbers (1-9, a form
   * step) or none (a row no key reaches) */
  keys?: "letters" | "numbers" | "none";
  /** #4910: what hangs right under a row (a follow-up field), by row id */
  after?: (id: string) => ReactNode;
  ariaLabel: string;
  onPick: (label: string) => void;
}) {
  if (!choices.length) return null;
  const keyOf = (index: number) => (keys === "numbers" ? String(index + 1) : keys === "none" ? "" : sheetKey(index));
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label={ariaLabel} onKeyDown={moveChoiceFocus} className="flex flex-col gap-px">
      {choices.map((choice, index) => {
        const id = choice.id ?? choice.label;
        const on = picked.includes(id);
        const rowOff = settled || disabled || choice.disabled === true;
        const Icon = choice.icon ? CHOICE_ICONS[choice.icon] : undefined;
        const below = after?.(id);
        return (
          <Fragment key={`${index}-${id}`}>
          <button
            type="button"
            data-ask-choice=""
            data-page-target={choice.id || undefined}
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            aria-disabled={choice.disabled === true || undefined}
            aria-keyshortcuts={settled || choice.disabled || !keyOf(index) ? undefined : keyOf(index)}
            disabled={rowOff}
            onClick={() => onPick(id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-2xl p-[7px] text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default",
              settled
                ? on ? quietPicked ? "" : "bg-ink/[0.06]" : "opacity-45"
                : choice.disabled ? "opacity-45"
                : on && !quietPicked ? "bg-ink/[0.07]" : "hover:bg-ink/[0.05]",
            )}
          >
            {multi ? <SheetBox on={on} /> : <SheetKey letter={keys === "none" ? "\u2022" : keyOf(index)} on={on} />}
            {Icon && <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
            <span className="min-w-0 flex-1">
              {/* plaintext bidi: each label orders its own script */}
              <span className="block break-words text-[14px] leading-5 text-ink [unicode-bidi:plaintext]">{choice.label}</span>
              {/* M-20261119-045: an option's detail is the bot's words, drawn as
                  in its bubble; inert in the row's button (a record link reads as
                  its label, a chip being a control of its own) */}
              {choice.description && (
                <CardMarkdown text={choice.description} inert className="block text-[13px] leading-[18px] text-ink-tertiary" />
              )}
            </span>
            {settled && on && !quietPicked && <Check size={15} strokeWidth={2.4} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
          </button>
          {below}
          </Fragment>
        );
      })}
    </div>
  );
}

/** The 24px key on a row (the reference's large key cap, #4490): 8px
 * corners, a hairline, 12/16 medium; the picked key in the accent fill. */
export function SheetKey({ letter, on, invalid = false }: { letter: string; on: boolean; invalid?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-lg border-[0.5px] text-[12px] font-medium leading-4 transition-colors",
        on ? "border-ink/20 bg-accent text-accent-ink" : invalid ? "border-danger bg-ink/[0.06] text-ink-secondary" : "border-ink/[0.14] bg-ink/[0.06] text-ink-secondary",
      )}
    >
      {letter}
    </span>
  );
}

/** A choose-several row's box, in the key's 24px slot. */
export function SheetBox({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">
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

/** The field look of every question card: an answer in words, and a form
 * row's time, date, number or duration (#4490). */
export const SHEET_FIELD =
  "rounded-[10px] border border-ink/[0.12] bg-ink/[0.04] py-2 px-3 text-[13.5px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus:border-ink/[0.28] focus-visible:ring-2 focus-visible:ring-accent/60";

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
  showSend = true,
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
  /** #4490: false in a form row: the form's one Submit sends, Enter too */
  showSend?: boolean;
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
        className={cn(SHEET_FIELD, "block max-h-40 min-h-9 w-full resize-none [field-sizing:content]", showSend && "pe-10")}
      />
      {showSend && value.trim() && (
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

// the reference's Submit (#4490): a filled pill, 8px by 16px, 14/20 medium;
// a second action is the same pill with no fill
const SEND = "rounded-full px-4 py-2 text-[14px] font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:opacity-35";
const SEND_MAIN = "bg-ink text-app hover:opacity-90";
const SEND_OTHER = "text-ink hover:bg-ink/[0.07]";

/** The send of a choose-several question, a set or a form: the reference's
 * filled pill. Several actions (a checklist's buttons, #4490) sit side by side, the
 * main one last. */
export function SheetSend({ label, disabled = false, onClick, actions }: {
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
  actions?: readonly { label: string; onClick: () => void; disabled?: boolean; id?: string }[];
}) {
  const all = actions ?? (label && onClick ? [{ label, onClick }] : []);
  return (
    <div className="mt-2.5 flex flex-wrap justify-end gap-1">
      {all.map((action, index) => (
        <button
          key={action.label}
          type="button"
          data-sheet-send=""
          data-wizard-action={action.id}
          onClick={action.onClick}
          disabled={disabled || action.disabled}
          className={cn(SEND, index === all.length - 1 ? SEND_MAIN : SEND_OTHER)}
        >
          {action.label}
        </button>
      ))}
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
