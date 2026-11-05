import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { OwlAvatar, type OwlAvatarHandle } from "@/components/OwlAvatar";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { RETRO_LOOKS, lookById, type RetroCharacter, type RetroLookId, type RetroOptions } from "./logic";
import { OwlFaceIcon } from "./RetroArt";
import { Win98Button, Win98Check, Win98Window } from "./Win98";
import { type CustomArtUrls } from "./AssistantArt";
import { Trombi } from "./Trombi";
import { CUSTOM_STATES, clearCustomArt, customArtReady, loadCustomArt, saveCustomArt, type CustomArtProblem, type CustomState } from "./custom-art";
import type { MenuItem } from "./retro-assistant-shared";

export function OwlMenu({ at, items, onClose, onPick }: { at: { x: number; y: number }; items: Array<{ id: MenuItem; label: string; separator?: boolean }>; onClose: () => void; onPick: (item: MenuItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [onClose]);
  const width = 196;
  const left = Math.min(at.x, window.innerWidth - width - 4);
  const top = Math.min(at.y, window.innerHeight - 24 * items.length - 20);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      list[(index + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    }
  };
  return (
    <div ref={ref} role="menu" aria-label={t("retro.menu.aria")} className="r98-menu" style={{ left, top, width }} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <div key={item.id}>
          {item.separator && <div className="r98-menu-sep" role="separator" />}
          <button type="button" role="menuitem" className="r98-menu-item" data-menu-item={item.id} onClick={() => onPick(item.id)}>
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

export function OptionsDialog({
  options,
  onSave,
  onClose,
  onReset,
}: {
  options: RetroOptions;
  onSave: (options: RetroOptions) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(options);
  const [resetDone, setResetDone] = useState(false);
  const flag = (key: keyof RetroOptions) => (value: boolean) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Win98Window title={t("retro.options.title")} onClose={onClose} icon={<OwlFaceIcon />} width={360}>
      <fieldset className="r98-group">
        <legend>{t("retro.options.group")}</legend>
        <Win98Check checked={draft.sounds} onChange={flag("sounds")}>{t("retro.options.sounds")}</Win98Check>
        <Win98Check checked={draft.keyboardTips} onChange={flag("keyboardTips")}>{t("retro.options.keyboardTips")}</Win98Check>
        <Win98Check checked={draft.guessHelp} onChange={flag("guessHelp")}>{t("retro.options.guessHelp")}</Win98Check>
        <Win98Check checked={draft.startupTip} onChange={flag("startupTip")}>{t("retro.options.startupTip")}</Win98Check>
      </fieldset>
      <fieldset className="r98-group">
        <legend>{t("retro.options.tipsGroup")}</legend>
        <p className="r98-hint">{t("retro.options.resetHint")}</p>
        <div className="r98-row r98-row-start">
          <Win98Button onClick={() => { onReset(); setResetDone(true); }}>{t("retro.options.reset")}</Win98Button>
          {resetDone && <span className="r98-hint" role="status">{t("retro.options.resetDone")}</span>}
        </div>
      </fieldset>
      <div className="r98-row">
        <Win98Button className="r98-default" onClick={() => onSave(draft)}>{t("retro.button.ok")}</Win98Button>
        <Win98Button onClick={onClose}>{t("retro.button.cancel")}</Win98Button>
      </div>
    </Win98Window>
  );
}

type GalleryEntry =
  | { kind: "trombi" }
  | { kind: "owl"; look: RetroLookId }
  | { kind: "custom" };

/** Trombi first, then the owl in each of its looks, then the person's own pictures. */
export const GALLERY: readonly GalleryEntry[] = [
  { kind: "trombi" },
  ...RETRO_LOOKS.map((look) => ({ kind: "owl" as const, look: look.id })),
  { kind: "custom" },
];

function galleryIndex(character: RetroCharacter, look: RetroLookId): number {
  const index = GALLERY.findIndex((entry) => entry.kind === character && (entry.kind !== "owl" || entry.look === look));
  return Math.max(0, index);
}

export function GalleryDialog({
  character,
  look,
  custom,
  onPick,
  onClose,
  onCustomize,
}: {
  character: RetroCharacter;
  look: RetroLookId;
  custom: CustomArtUrls;
  onPick: (choice: { character: RetroCharacter; look?: RetroLookId }) => void;
  onClose: () => void;
  onCustomize: () => void;
}) {
  const [index, setIndex] = useState(() => galleryIndex(character, look));
  const preview = useRef<OwlAvatarHandle>(null);
  const entry = GALLERY[index];
  const step = (delta: number) => {
    setIndex((value) => (value + delta + GALLERY.length) % GALLERY.length);
    setTimeout(() => preview.current?.flourish("hoot"), 30);
  };
  const owlLook = entry.kind === "owl" ? lookById(entry.look) : null;
  const name = entry.kind === "trombi" ? t("retro.character.trombi.name") : entry.kind === "custom" ? t("retro.character.custom.name") : t(owlLook!.name);
  const bio = entry.kind === "trombi" ? t("retro.character.trombi.bio") : entry.kind === "custom" ? t("retro.character.custom.bio") : t(owlLook!.bio);
  const customMissing = entry.kind === "custom" && !custom.idle;
  return (
    <Win98Window title={t("retro.gallery.title")} onClose={onClose} icon={<OwlFaceIcon />} width={390}>
      <p className="r98-hint">{t("retro.gallery.intro")}</p>
      <div className="r98-gallery">
        <div className="r98-sunken r98-gallery-stage">
          {entry.kind === "trombi" && <Trombi pose="idle" size={92} label={name} />}
          {owlLook && <OwlAvatar ref={preview} key={owlLook.id} color={owlLook.color} skin={owlLook.skin} size={112} skinAnimated label={name} />}
          {entry.kind === "custom" && (custom.idle ? <img className="r98-custom-art" src={custom.idle} alt={name} width={110} height={110} /> : <span className="r98-gallery-empty">{t("retro.custom.none")}</span>)}
        </div>
        <div className="r98-gallery-text">
          <strong className="r98-gallery-name">{name}</strong>
          <p>{bio}</p>
          {entry.kind === "custom" && (
            <div className="r98-row r98-row-start">
              <Win98Button onClick={onCustomize}>{t("retro.custom.configure")}</Win98Button>
            </div>
          )}
          <span className="r98-hint">{t("retro.gallery.count", { index: index + 1, total: GALLERY.length })}</span>
        </div>
      </div>
      <div className="r98-row r98-row-split">
        <div className="r98-row">
          <Win98Button onClick={() => step(-1)}>{t("retro.button.back")}</Win98Button>
          <Win98Button onClick={() => step(1)}>{t("retro.button.next")}</Win98Button>
        </div>
        <div className="r98-row">
          <Win98Button
            className="r98-default"
            disabled={customMissing}
            onClick={() => onPick(entry.kind === "owl" ? { character: "owl", look: entry.look } : { character: entry.kind })}
          >
            {t("retro.button.ok")}
          </Win98Button>
          <Win98Button onClick={onClose}>{t("retro.button.cancel")}</Win98Button>
        </div>
      </div>
    </Win98Window>
  );
}

const STATE_LABELS: Record<CustomState, LocaleKey> = {
  idle: "retro.custom.state.idle",
  speak: "retro.custom.state.speak",
  think: "retro.custom.state.think",
  sleep: "retro.custom.state.sleep",
  celebrate: "retro.custom.state.celebrate",
  send: "retro.custom.state.send",
};

const PROBLEMS: Record<CustomArtProblem, LocaleKey> = {
  type: "retro.custom.problem.type",
  size: "retro.custom.problem.size",
  storage: "retro.custom.problem.storage",
};

/** "Custom assistant": one picture per moment, stored on this computer only. */
export function CustomAssistantDialog({ custom, onChanged, onClose, onUse }: { custom: CustomArtUrls; onChanged: () => void; onClose: () => void; onUse: () => void }) {
  const [problem, setProblem] = useState<CustomArtProblem | null>(null);
  const [ready, setReady] = useState(Boolean(custom.idle));
  useEffect(() => {
    void loadCustomArt().then((art) => setReady(customArtReady(art)));
  }, [custom]);
  const pick = async (state: CustomState, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = await saveCustomArt(state, file);
    setProblem(result);
    if (!result) onChanged();
  };
  return (
    <Win98Window title={t("retro.custom.title")} onClose={onClose} icon={<OwlFaceIcon />} width={400}>
      <p className="r98-hint">{t("retro.custom.intro")}</p>
      <fieldset className="r98-group">
        <legend>{t("retro.custom.group")}</legend>
        <div className="r98-custom-grid">
          {CUSTOM_STATES.map((state) => {
            const inputId = `r98-custom-${state}`;
            const src = custom[state];
            return (
              <div key={state} className="r98-custom-row" data-custom-state={state}>
                <span className="r98-sunken r98-custom-thumb">{src ? <img src={src} alt="" width={28} height={28} /> : null}</span>
                <span className="r98-custom-label">{t(STATE_LABELS[state])}</span>
                <label className="r98-btn r98-file" htmlFor={inputId}>
                  {t("retro.custom.browse")}
                  <input id={inputId} type="file" accept="image/png,image/gif" onChange={(event) => void pick(state, event)} />
                </label>
                <Win98Button disabled={!src} onClick={() => void clearCustomArt(state).then(onChanged)}>{t("retro.custom.clear")}</Win98Button>
              </div>
            );
          })}
        </div>
      </fieldset>
      {problem && <p className="r98-hint r98-problem" role="alert">{t(PROBLEMS[problem])}</p>}
      <div className="r98-row">
        <Win98Button className="r98-default" disabled={!ready} onClick={onUse}>{t("retro.custom.use")}</Win98Button>
        <Win98Button onClick={onClose}>{t("retro.button.cancel")}</Win98Button>
      </div>
    </Win98Window>
  );
}
