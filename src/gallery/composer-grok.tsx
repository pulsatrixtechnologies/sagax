/** Isolated gallery for Playwright screenshots of the composer's controls
 * after Grok Bot's prompt bar. Not shipped in the app.
 * ?skin=<id>&lang=<code>&color=<bot color>&name=<bot name>
 * &state=rest|typed|dictation|menu&mode=after|before&lines=1|3&dot=1
 * `before` draws the row as origin/main had it (paperclip, approval hand,
 * workspace globe, ringed mic, ink call button), for the side-by-side. */
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AudioLines, ChevronDown, Globe, Hand, Mic, Paperclip } from "lucide-react";
import { MentionTextarea } from "../components/MentionTextarea";
import { ATTACH_ICON, ComposerCtaSeat, ComposerMicButton, ComposerPlusMenu, ComposerSendButton, DictationChip, RecordMark } from "../components/ComposerControls";
import { cn } from "../lib/cn";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { botCtaColors, CTA_CIRCLE, CTA_DEFAULT, CTA_TONED, ctaStyle } from "../lib/voice-cta";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const state = params.get("state") ?? "rest";
const before = params.get("mode") === "before";
const color = params.get("color") ?? "teal";
const name = params.get("name") ?? "Harrie";
const lines = Number(params.get("lines") ?? "1");
// the warning dot of a Voice button whose voice is not set up yet
const dot = params.get("dot") === "1";
const typedText = lines > 1
  ? Array.from({ length: lines }, (_, i) => `Ligne ${i + 1} du message`).join("\n")
  : state === "typed" ? "Peux-tu vérifier la sauvegarde de ce soir ?" : state === "dictation" ? "Rappelle-moi d'appeler" : "";

const PILL = "@container/composer relative z-[1] min-h-11 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5 shadow-[0_2px_8px_-1px_#0000000d,0_1px_2px_#00000008,0_0_0_1px_#e4e4e40a]";

function Field({ value }: { value: string }) {
  return (
    <textarea
      readOnly
      rows={1}
      value={value}
      placeholder={t("composer.placeholder.bot", { name })}
      className="block max-h-[7.5rem] min-h-6 w-full flex-1 resize-none overflow-y-auto bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none"
    />
  );
}

function ModelChip() {
  return <span className="flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-ink-secondary">Claude Sonnet 5 <ChevronDown size={12} /></span>;
}

/** The composer's field as the app draws it (MentionTextarea, same classes). */
function RealField({ value }: { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <MentionTextarea
      inputRef={ref}
      peers={[]}
      wrapperClassName="@max-[30rem]/composer:order-first @max-[30rem]/composer:basis-full"
      readOnly
      rows={1}
      value={value}
      placeholder={t("composer.placeholder.bot", { name })}
      className="block max-h-[7.5rem] min-h-6 w-full resize-none overflow-y-auto bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none"
    />
  );
}

function After() {
  const tone = botCtaColors(color);
  const [seconds] = useState(4);
  const dictating = state === "dictation";
  // CallButton's markup: a relative wrapper, the round button, the dot
  const voice = (
    <div className="relative">
      <button type="button" aria-label={t("voiceMode.start", { name })} data-composer-voice="" style={ctaStyle(tone)} className={cn(CTA_CIRCLE, tone ? CTA_TONED : CTA_DEFAULT)}>
        <AudioLines size={16} strokeWidth={2.25} />
        {dot && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warning ring-2 ring-app" aria-hidden="true" />}
      </button>
    </div>
  );
  return (
    <div className={PILL}>
      <div data-composer-row className="flex items-end gap-1 @max-[30rem]/composer:flex-wrap">
        <div className="composer-band flex flex-wrap items-center gap-2">
          <ComposerPlusMenu
            initialOpen={state === "menu"}
            items={[
              { id: "attach", label: t("composer.plus.attach"), icon: ATTACH_ICON, onSelect: () => {} },
              { id: "teach", label: t("composer.plus.teach"), icon: <RecordMark />, onSelect: () => {} },
            ]}
          />
        </div>
        <RealField value={typedText} />
        <div data-composer-actions className="composer-band flex items-center gap-1 @max-[30rem]/composer:ml-auto">
          <ComposerMicButton onClick={() => {}} hidden={dictating} shortcut="⌘D" />
          {dictating ? (
            <DictationChip seconds={seconds} levels={[0.25, 0.6, 0.95, 0.5, 0.35]} processing={false} onStop={() => {}} onCancel={() => {}} onSend={() => {}} sendTone={tone} />
          ) : (
            <ComposerCtaSeat
              typed={Boolean(typedText)}
              voice={voice}
              send={<ComposerSendButton onClick={() => {}} disabled={!typedText} tone={tone} queued={false} label={t("composer.send.message")} title={t("composer.send.message")} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** origin/main's row, from its Composer markup. */
function Before() {
  return (
    <div className={PILL}>
      <div className="flex items-end gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink"><Paperclip size={17} /></button>
          <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink"><Hand size={16} className="shrink-0 opacity-80" /></button>
          <button type="button" className="relative flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-ink-secondary hover:bg-control hover:text-ink"><Globe size={16} className="shrink-0 opacity-80" /></button>
        </div>
        <Field value={typedText} />
        <div className="flex items-center gap-1">
          <ModelChip />
          {!typedText && (
            <button type="button" className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", state === "dictation" ? "animate-pulse bg-danger/20 text-danger" : "text-ink-secondary ring-1 ring-hairline/60")}><Mic size={18} /></button>
          )}
          <button type="button" className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-app"><AudioLines size={15} /></button>
          {typedText && state !== "dictation" && (
            <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">↑</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Gallery() {
  return (
    <div className="flex min-h-dvh items-end bg-app px-6 pb-6 pt-[260px]">
      <div className="w-full" data-gallery-composer="">{before ? <Before /> : <After />}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
