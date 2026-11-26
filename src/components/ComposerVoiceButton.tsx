// The chat bar's one voice button (owner 2026-11-25, M-20261125-071,
// M-20261125-072, #5372): dictation and the voice conversation are one
// button. Its face is the mode kept: the mic for dictation, the waves for
// the conversation, and a click starts it. Its arrow opens a menu that
// chooses between the two, then the microphone (with its live level) and
// the dictation's language. Both functions stay whole: the faces are the
// composer's own mic button and the bot's call button. What cannot be is
// absent: no mode choice where a conversation cannot start (a group), no
// language under the Mac's own dictation (it follows the system's).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, Check, ChevronDown, Mic } from "lucide-react";

import { useAudioInputs } from "@/lib/audio-input";
import { cn } from "@/lib/cn";
import { DICTATION_BARS, dictationLevels } from "@/lib/composer-dictation";
import { dictationLanguageOptions, setComposerVoiceMode, setDictationLanguage, shownVoiceMode, useComposerVoiceMode, useDictationLanguage, type ComposerVoiceMode } from "@/lib/composer-voice";
import { t } from "@/lib/i18n";
import { LevelMeter } from "./ComposerControls";
import { MENU_FIT_ROW, MENU_SURFACE, MenuDivider, MenuGlyph, menuRow } from "./menu-look";
import { openMicrophone } from "./useComposerDictation";

const REST = Array.from({ length: DICTATION_BARS }, () => 0);

/** The microphone's loudness while the menu is open, as the dictation
 * pill's bars; at rest when the microphone cannot be opened. */
function useMicrophoneLevels(open: boolean, input: string | undefined): number[] {
  const [levels, setLevels] = useState<number[]>(REST);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let stop: (() => void) | null = null;
    const heard: number[] = [];
    void openMicrophone((level) => { heard.push(level); if (heard.length > 64) heard.shift(); }, null)
      .then((mic) => { if (alive) stop = mic.stop; else mic.stop(); })
      .catch(() => undefined);
    const timer = window.setInterval(() => { if (alive) setLevels(dictationLevels(heard)); }, 100);
    return () => {
      alive = false;
      window.clearInterval(timer);
      stop?.();
      setLevels(REST);
    };
  }, [open, input]);
  return levels;
}

export function ComposerVoiceButton({ dictation, conversation, engine, hidden = false }: {
  /** The mic: dictation into the field (ComposerMicButton). */
  dictation: ReactNode;
  /** The waves: the voice conversation with this bot (CallButton). Absent
   * where it cannot start (a group). */
  conversation?: ReactNode;
  /** Which ears dictate: the language is chosen only for xAI's. */
  engine: "native" | "xai" | null;
  /** Folded away while the dictation or voice note pill shows. */
  hidden?: boolean;
}) {
  const kept = useComposerVoiceMode();
  const mode = shownVoiceMode(kept, { conversation: Boolean(conversation) });
  const language = useDictationLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const mic = useAudioInputs();
  const levels = useMicrophoneLevels(open && !hidden, mic.selected);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  useEffect(() => { if (hidden) setOpen(false); }, [hidden]);

  if (hidden) return null;
  const choose = (next: ComposerVoiceMode) => { setComposerVoiceMode(next); setOpen(false); };
  const modes: Array<[ComposerVoiceMode, string, ReactNode]> = [
    ["dictation", t("composer.voice.dictation"), <Mic key="mic" size={16} aria-hidden="true" />],
    ["conversation", t("composer.voice.conversation"), <AudioLines key="waves" size={16} aria-hidden="true" />],
  ];
  const listed = mic.selected ? mic.inputs.some((input) => input.id === mic.selected) : true;
  const inputs: Array<{ id: string | null; label: string }> = [
    { id: null, label: t("settings.microphone.default") },
    ...mic.inputs.map((input, index) => ({ id: input.id, label: input.label || t("settings.microphone.unnamed", { number: index + 1 }) })),
    ...(mic.selected && !listed && mic.loaded ? [{ id: mic.selected, label: t("settings.microphone.missing") }] : []),
  ];
  return (
    <span ref={rootRef} data-composer-voice-button="" data-mode={mode} className="relative flex h-7 shrink-0 items-center rounded-full bg-[var(--composer-control-fill)]">
      {mode === "conversation" ? conversation : dictation}
      <button
        type="button"
        data-composer-voice-menu-toggle=""
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("composer.voice.menu")}
        title={t("composer.voice.menu")}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-5 shrink-0 items-center justify-center rounded-r-full pr-1 text-[var(--composer-control-ink)] outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-focus"
      >
        <ChevronDown size={12} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={t("composer.voice.menu")} data-composer-voice-menu="" className={cn(MENU_SURFACE, MENU_FIT_ROW, "absolute bottom-full right-0 z-40 mb-3.5")}>
          {conversation && modes.map(([key, label, glyph]) => (
            <button key={key} type="button" role="menuitemradio" aria-checked={mode === key} data-voice-mode-row={key} onClick={() => choose(key)} className={menuRow()}>
              <MenuGlyph>{glyph}</MenuGlyph>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {mode === key && <Check size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
            </button>
          ))}
          {conversation && <MenuDivider />}
          <div data-voice-microphone="" className="flex items-center justify-between gap-3 px-2 pb-0.5 pt-1 text-[12px] leading-4 text-ink-secondary">
            <span>{t("settings.microphone.title")}</span>
            <LevelMeter levels={levels} />
          </div>
          {inputs.map((input) => {
            const on = (mic.selected ?? null) === input.id;
            return (
              <button key={input.id ?? "default"} type="button" role="menuitemradio" aria-checked={on} data-voice-mic-row={input.id ?? "default"}
                onClick={() => mic.select(input.id)} className={menuRow()}>
                <span className="min-w-0 flex-1 truncate">{input.label}</span>
                {on && <Check size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
              </button>
            );
          })}
          {engine === "xai" && (
            <>
              <MenuDivider />
              <label data-voice-language="" className="flex h-8 items-center justify-between gap-3 px-2">
                <span className="shrink-0">{t("composer.voice.language")}</span>
                <select value={language} onChange={(event) => setDictationLanguage(event.target.value)}
                  className="min-w-0 max-w-[160px] truncate rounded-md bg-transparent text-right text-ink-secondary outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  {dictationLanguageOptions().map((option) => (
                    <option key={option.code} value={option.code}>{option.code === "auto" ? t("voiceMode.autoDetect") : option.label}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      )}
    </span>
  );
}
