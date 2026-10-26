// The composer's round controls, measured on Grok Bot's prompt bar (0.71):
// 28 px circles 8 px apart, a quiet "secondary" circle (+, mic) and a filled
// call to action (Voice, or Send once something is typed) whose glyphs
// cross-fade (opacity and scale .5 -> 1, 200 ms, ease-out-quint).
// While dictating, the mic and the CTA give way to a pill: a 10 px stop
// square, the timer (14/22, tabular) and an 18 x 13 px level meter, then a
// Send arrow. The + opens a menu above it, aligned on its start edge.
// A voice note (+ > Record a voice note) takes the same seat: cancel, a red
// dot, the timer and a 24 bar waveform, then Send.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, AudioLines, Brain, Check, ChevronRight, Clock, Loader2, Mic, Paperclip, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatDictationTime } from "@/lib/composer-dictation";
import { focusFirstMenuItem, moveMenuFocus } from "@/lib/menu-keys";
import { CTA_CIRCLE, CTA_DEFAULT, CTA_TONED, ctaStyle, type BotCtaColors } from "@/lib/voice-cta";
import { useMenuMotion } from "./MenuMotion";
import type { ComposerModelChip } from "./ModelPicker";

/** The quiet circle: a translucent ink wash, a 0.5 px inner hairline, tertiary ink brightening on hover. */
export const SECONDARY_CIRCLE = cn(
  CTA_CIRCLE,
  "bg-ink/[0.06] text-ink-tertiary shadow-[inset_0_0_0_0.5px_var(--color-border)] hover:bg-ink/[0.1] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
);

/** Grok Bot's glyph cross-fade. */
const GLYPH = "absolute inset-0 m-auto transition-[opacity,transform] duration-moderate ease-out-quint motion-reduce:transition-none";
const glyphShown = (shown: boolean) => (shown ? "opacity-100 scale-100" : "opacity-0 scale-50");
/** The seat's fade: no transform once shown, so the Voice button's popover is not trapped in a stacking context. */
const seatShown = (shown: boolean) => (shown ? "opacity-100" : "opacity-0 scale-50");

/** The "Teach a task" mark: a ring and a dot, in the danger red (a recording). */
export function RecordMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" fill="none" className={cn("shrink-0 text-danger", className)}>
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="2.9" fill="currentColor" />
    </svg>
  );
}

export interface PlusMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Rows of one group sit together; a hairline separates the groups. */
  group?: "add" | "modes";
  /** A mode: a checkbox row, checked while it is on. */
  checked?: boolean;
  /** What else reaches it (`/goal`), at the row's end. */
  hint?: string;
}

/** The + at the start of the composer and its menu, in groups (Grok Bot's
 * composer actions, Cursor's grouped menus): add (Attach files, Teach a
 * task), modes (Goal, Setup), then the conversation's own settings as rows
 * that open beside it (`rows`, rendered by their owners: the model and the
 * approval level). */
export function ComposerPlusMenu({
  items,
  rows,
  disabled = false,
  initialOpen = false,
  onOpenChange,
}: {
  items: PlusMenuItem[];
  /** Rows that own a menu of their own; each gets `close` to call once picked. */
  rows?: (close: () => void) => ReactNode;
  disabled?: boolean;
  /** Tests and the gallery: render with the menu open. */
  initialOpen?: boolean;
  /** The menu opened or closed (the model menu beside it closes with it). */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  useEffect(() => {
    openChange.current?.(open);
  }, [open]);
  const motion = useMenuMotion(open);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      // the model menu is portalled beside this one: a click in it stays in
      if (event.target instanceof Element && event.target.closest("[data-model-menu]")) return;
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // a row's own menu is open: its Escape closes it first
      if (menuRef.current?.querySelector('[aria-expanded="true"]')) return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || initialOpen) return;
    const frame = requestAnimationFrame(() => focusFirstMenuItem(menuRef.current));
    return () => cancelAnimationFrame(frame);
  }, [open, initialOpen]);

  return (
    <div ref={wrapperRef} className="relative flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("composer.plus.aria")}
        title={t("composer.plus.aria")}
        disabled={disabled}
        data-composer-plus=""
        data-tour="composer-plus"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={SECONDARY_CIRCLE}
      >
        <Plus size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {motion.shown && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("composer.plus.aria")}
          data-composer-plus-menu=""
          onKeyDown={(event) => {
            if (moveMenuFocus(event.currentTarget, event.key, document.activeElement)) event.preventDefault();
          }}
          className={cn(
            "absolute bottom-full left-0 z-40 mb-2 flex min-w-[220px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5",
            motion.className,
          )}
          {...motion.exitProps}
        >
          {items.map((item, index) => {
            const startsGroup = index > 0 && (items[index - 1]!.group ?? "add") !== (item.group ?? "add");
            const mode = item.checked !== undefined;
            return (
              <div key={item.id} className="contents">
                {startsGroup && <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />}
                <button
                  type="button"
                  role={mode ? "menuitemcheckbox" : "menuitem"}
                  aria-checked={mode ? item.checked : undefined}
                  disabled={item.disabled}
                  data-composer-plus-item={item.id}
                  data-composer-plus-group={item.group ?? "add"}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                  className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 font-mono text-[11px] text-ink-tertiary">{item.hint}</span>}
                  {mode && (
                    <Check size={14} aria-hidden="true" className={cn("shrink-0 text-accent", !item.checked && "invisible")} />
                  )}
                </button>
              </div>
            );
          })}
          {rows && (() => {
            const content = rows(() => close(true));
            return content ? (
              <>
                <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />
                {content}
              </>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}

/** The + menu's Model row (JC, 2026-10-18): the model in use at its end,
 * the model menu (search, Auto, the bot's model, favorites, Provider ›,
 * Effort, Edit…) beside it. The composer has no model chip any more. */
export function ComposerModelRow({ chip, onOpen }: {
  chip: ComposerModelChip;
  /** Opens (or closes) the model menu beside this row. */
  onOpen: (row: HTMLElement) => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (rowRef.current && !chip.busy) onOpen(rowRef.current);
  };
  return (
    <button
      ref={rowRef}
      type="button"
      role="menuitem"
      aria-haspopup="dialog"
      aria-expanded={chip.open}
      aria-label={t("composer.plus.modelAria", { model: chip.label })}
      title={chip.title}
      disabled={chip.busy}
      data-composer-plus-row="model"
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" && !chip.open) { event.preventDefault(); toggle(); }
      }}
      className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none aria-expanded:bg-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <Brain size={16} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{t("composer.plus.model")}</span>
      <span data-composer-model-value className={cn("max-w-[140px] shrink truncate text-ink-tertiary", chip.ultracode && "ultracode-effort-chip")}>{chip.label}</span>
      <ChevronRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
    </button>
  );
}

/** Attach files: the menu's first row. */
export const ATTACH_ICON = <Paperclip size={16} aria-hidden="true" />;

/** The grey mic: dictation into the field. Without an engine it says so and opens the Keys card. */
export function ComposerMicButton({ onClick, onPress, onRelease, hidden = false, needsSetup = false, shortcut }: {
  onClick: () => void;
  /** Pointer down / up: hold to dictate (the composer decides tap or hold). */
  onPress?: () => void;
  onRelease?: () => void;
  /** Folded away (width 0) while the dictation pill shows. */
  hidden?: boolean;
  needsSetup?: boolean;
  /** "⌘D" or "Ctrl+D". */
  shortcut: string;
}) {
  const label = needsSetup ? t("composer.dictation.needsKey") : t("composer.dictation.start");
  return (
    // The slot's width snaps (an animated width would re-wrap the draft on
    // every frame); the button itself fades and scales in, compositor only.
    <span className={cn("flex shrink-0 overflow-hidden", hidden ? "me-0 w-0" : "w-7")}>
      <button
        type="button"
        onClick={onClick}
        onPointerDown={(event) => { if (event.button === 0) onPress?.(); }}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        aria-label={label}
        title={needsSetup ? label : t("composer.dictation.holdHint", { shortcut })}
        data-composer-mic={needsSetup ? "setup" : ""}
        tabIndex={hidden ? -1 : undefined}
        aria-hidden={hidden || undefined}
        className={cn(SECONDARY_CIRCLE, "transition-[color,background-color,opacity,scale] duration-moderate ease-out-quint motion-reduce:transition-none", hidden && "invisible scale-50 opacity-0")}
      >
        <Mic size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </span>
  );
}

/** Send, in the CTA's place once something is typed. */
export function ComposerSendButton({ onClick, disabled, tone, queued, label, title }: {
  onClick: () => void;
  disabled: boolean;
  tone?: BotCtaColors | null;
  /** The turn is busy and the message will wait: a clock on the quiet circle. */
  queued: boolean;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      data-composer-send=""
      style={queued ? undefined : ctaStyle(tone)}
      className={cn(
        queued ? SECONDARY_CIRCLE : cn(CTA_CIRCLE, tone ? CTA_TONED : CTA_DEFAULT),
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      <Clock size={15} aria-hidden="true" className={cn(GLYPH, glyphShown(queued))} />
      <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" className={cn(GLYPH, glyphShown(!queued))} />
    </button>
  );
}

/** The CTA seat: Send when something is typed, Voice otherwise, cross-faded. */
export function ComposerCtaSeat({ send, voice, typed }: { send: ReactNode; voice: ReactNode; typed: boolean }) {
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center" data-composer-cta={typed ? "send" : "voice"}>
      <span inert={typed} className={cn("absolute inset-0 flex items-center justify-center", GLYPH, seatShown(!typed), typed && "pointer-events-none")}>{voice}</span>
      <span inert={!typed} className={cn("absolute inset-0 flex items-center justify-center", GLYPH, seatShown(typed), !typed && "pointer-events-none")}>{send}</span>
    </span>
  );
}

/** A level bar's height (3..13 px) as a share of the meter's 13 px. */
export function levelBarScale(level: number): number {
  return Math.round(3 + Math.max(0, Math.min(1, level)) * 10) / 13;
}

/** The level meter: five 2 px bars, 2 px apart, 3..13 px tall, in the secondary ink. */
export function LevelMeter({ levels }: { levels: number[] }) {
  return (
    <span aria-hidden="true" className="flex h-[13px] w-[18px] shrink-0 items-center gap-[2px]" data-dictation-levels="">
      {levels.map((level, index) => (
        <span
          key={index}
          // full height, scaled: the meter moves on the compositor, never by layout
          className="h-[13px] w-[2px] rounded-full bg-ink-secondary transition-transform duration-75 motion-reduce:transition-none"
          style={{ transform: `scaleY(${levelBarScale(level)})` }}
        />
      ))}
    </span>
  );
}

/** The dictation pill: stop square, timer and levels (click stops, Escape discards), then Send. */
export function DictationChip({ seconds, levels, processing, onStop, onCancel, onSend, sendTone }: {
  seconds: number;
  levels: number[];
  processing: boolean;
  onStop: () => void;
  onCancel: () => void;
  onSend: () => void;
  sendTone?: BotCtaColors | null;
}) {
  const time = formatDictationTime(seconds);
  if (processing) {
    return (
      <span role="status" aria-label={t("composer.dictation.processing")} title={t("composer.dictation.processing")} className={cn(CTA_CIRCLE, "text-ink-secondary")} data-dictation-chip="processing">
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-2" data-dictation-chip="recording">
      <button
        type="button"
        onClick={onStop}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        aria-label={t("composer.dictation.stopAria", { time })}
        title={t("composer.dictation.stopHint")}
        className="box-border inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-ink/[0.06] py-1 pe-2.5 ps-2.5 text-ink transition-colors duration-[120ms] hover:bg-ink/[0.1] focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px] bg-ink" />
        <span aria-hidden="true" className="shrink-0 text-[14px] leading-[22px] tracking-[-0.15px] tabular-nums">{time}</span>
        <LevelMeter levels={levels} />
      </button>
      <ComposerSendButton onClick={onSend} disabled={false} tone={sendTone} queued={false} label={t("composer.send.message")} title={t("composer.send.message")} />
    </span>
  );
}

/** Record a voice note: a row of the + menu. */
export const VOICE_NOTE_ICON = <AudioLines size={16} aria-hidden="true" />;

/** The voice note's waveform: 2 px bars, 2 px apart, 3..16 px tall, in the danger red. */
export function VoiceNoteWaveform({ bars }: { bars: number[] }) {
  return (
    <span aria-hidden="true" className="flex h-4 shrink-0 items-center gap-[2px]" data-voice-note-waveform="">
      {bars.map((level, index) => (
        <span
          key={index}
          // full height, scaled: the waveform moves on the compositor, never by layout
          className="h-4 w-[2px] rounded-full bg-danger/80 transition-transform duration-75 motion-reduce:transition-none"
          style={{ transform: `scaleY(${Math.round(3 + Math.max(0, Math.min(1, level)) * 13) / 16})` }}
        />
      ))}
    </span>
  );
}

/** The voice note pill: cancel, a recording dot, the timer and the waveform,
 * then Send (Escape cancels). While the clip uploads, a spinner. */
export function VoiceNoteChip({ seconds, bars, sending, onCancel, onSend, sendTone }: {
  seconds: number;
  bars: number[];
  sending: boolean;
  onCancel: () => void;
  onSend: () => void;
  sendTone?: BotCtaColors | null;
}) {
  const time = formatDictationTime(seconds);
  const sendRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sending) sendRef.current?.focus();
  }, [sending]);
  if (sending) {
    return (
      <span role="status" aria-label={t("composer.voiceNote.sending")} title={t("composer.voiceNote.sending")} className={cn(CTA_CIRCLE, "text-ink-secondary")} data-voice-note-chip="sending">
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-2"
      data-voice-note-chip="recording"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label={t("composer.voiceNote.cancel")}
        title={t("composer.voiceNote.cancelHint")}
        className={SECONDARY_CIRCLE}
        data-voice-note-cancel=""
      >
        <X size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
      <span
        role="timer"
        aria-label={t("composer.voiceNote.recordingAria", { time })}
        className="box-border inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-ink/[0.06] py-1 pe-2.5 ps-2.5 text-ink"
      >
        <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
        <span aria-hidden="true" className="shrink-0 text-[14px] leading-[22px] tracking-[-0.15px] tabular-nums">{time}</span>
        <VoiceNoteWaveform bars={bars} />
      </span>
      <button
        ref={sendRef}
        type="button"
        onClick={onSend}
        aria-label={t("composer.voiceNote.send")}
        title={t("composer.voiceNote.send")}
        data-voice-note-send=""
        style={ctaStyle(sendTone)}
        className={cn(CTA_CIRCLE, sendTone ? CTA_TONED : CTA_DEFAULT)}
      >
        <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </span>
  );
}
