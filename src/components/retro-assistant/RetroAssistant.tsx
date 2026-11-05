// Hibou 98: a late-90s desktop assistant. Loaded lazily the first time the
// easter egg is switched on (see src/lib/retro98.ts), so none of this costs
// anything on a device that never finds it.
//
// It recreates the era's behaviour with our own assets: an eager helper that
// perks up and taps the glass when you write a long message, paste, switch
// conversations or come back from a break; a balloon with a question, round
// bullet choices and a "What would you like to do?" search; a light bulb when
// a tip is waiting; an idle cycle that ends in a doze; a context menu, an
// assistant gallery and an options dialog. Trombi the paperclip is the
// default; the app's owl and the person's own pictures can stand in instead.
// Every word, icon and sound here is original.
//
// On the desktop app the assistant can also leave the window ("Detach from
// the window"): this component stays the brain and sends a plain snapshot of
// what to draw to a small always-on-top window (DetachedAssistant.tsx), which
// reports clicks back.
import "./retro-assistant.css";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { OwlAvatarHandle } from "@/components/OwlAvatar";
import type { OwlGaze } from "@/lib/owl/owl-art";
import { activeLocale, t } from "@/lib/i18n";
import { setRetroEnabled } from "@/lib/retro98";
import { useStore } from "@/state/store";
import type { LocaleKey } from "@/locales";
import {
  RANDOM_ANIMATIONS,
  RETRO_GUESSES,
  assistantPose,
  characterBox,
  lookById,
  mayGuess,
  motionPlan,
  nextTip,
  readPrefs,
  searchTips,
  writePrefs,
  type GuessKind,
  type IdlePhase,
  type RetroAnimation,
  type RetroPrefs,
  type RetroTip,
  type TipAction,
} from "./logic";
import { createRetroSounds } from "./sounds";
import { useCustomArtUrls } from "./AssistantArt";
import type { DetachedSnapshot } from "./detached-protocol";
import {
  characterStrings,
  perchAboveComposer,
  type Act,
  type Balloon,
  type BalloonModel,
  type MenuItem,
} from "./retro-assistant-shared";
import { buildBalloonModel } from "./buildBalloonModel";
import { useRetroAssistantActivity } from "./useRetroAssistantActivity";
import { useRetroAssistantDetached } from "./useRetroAssistantDetached";
import { useRetroAssistantDrag } from "./useRetroAssistantDrag";
import { RetroAssistantChrome } from "./RetroAssistantChrome";
import { CustomAssistantDialog, GALLERY, GalleryDialog, OptionsDialog, OwlMenu } from "./RetroAssistantDialogs";

export type { MenuItem, BalloonModel } from "./retro-assistant-shared";
export { GALLERY };

/**
 * The right-click menu. "Detach from the window" appears only where the
 * desktop app can host the assistant in its own window; once detached, the
 * same slot offers to put it back.
 */
export function assistantMenu(canDetach: boolean, detached: boolean): Array<{ id: MenuItem; label: LocaleKey; separator?: boolean }> {
  const items: Array<{ id: MenuItem; label: LocaleKey; separator?: boolean }> = [
    { id: "hide", label: "retro.menu.hide" },
    { id: "options", label: "retro.menu.options", separator: true },
    { id: "gallery", label: "retro.menu.choose" },
    { id: "animate", label: "retro.menu.animate", separator: true },
  ];
  if (canDetach) items.push(detached ? { id: "attach", label: "retro.menu.attach", separator: true } : { id: "detach", label: "retro.menu.detach", separator: true });
  return items;
}

export interface RetroAssistantProps {
  /** True once the mode was switched off: play the exit, then call onGone. */
  leaving?: boolean;
  /** Switched on just now (a welcome), rather than restored at startup. */
  fresh?: boolean;
  onGone?: () => void;
  /** Tests and previews pin reduced motion; undefined follows the OS. */
  reducedMotion?: boolean;
  /** The app language; a change re-renders every balloon string. */
  locale?: string;
}

function useReducedMotion(forced?: boolean): boolean {
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  const [reduced, setReduced] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [query]);
  return forced ?? reduced;
}

export default function RetroAssistant({ leaving = false, fresh = false, onGone, reducedMotion, locale }: RetroAssistantProps) {
  const { state, dispatch } = useStore();
  const reduced = useReducedMotion(reducedMotion);
  const plan = motionPlan(reduced);
  const language = locale ?? activeLocale();

  const [prefs, setPrefsState] = useState<RetroPrefs>(() => readPrefs());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = useCallback((update: (current: RetroPrefs) => RetroPrefs) => {
    setPrefsState((current) => {
      const next = update(current);
      writePrefs(next);
      return next;
    });
  }, []);

  const [balloon, setBalloon] = useState<Balloon | null>(null);
  const [bulb, setBulb] = useState<RetroTip | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<"options" | "gallery" | "custom" | null>(null);
  const [mood, setMood] = useState<IdlePhase>("awake");
  const [act, setAct] = useState<Act | null>(null);
  const [envelopes, setEnvelopes] = useState<number[]>([]);
  const [gaze, setGaze] = useState<OwlGaze | undefined>(undefined);
  const [perch, setPerch] = useState(() => perchAboveComposer());
  const [query, setQuery] = useState("");
  const [artVersion, setArtVersion] = useState(0);

  const owl = useRef<OwlAvatarHandle>(null);
  const lastActivity = useRef(Date.now());
  const lastGuess = useRef<Partial<Record<GuessKind, number>>>({});
  const lastTipAt = useRef(0);
  const lastTipId = useRef<string | null>(null);
  const longArmed = useRef(true);
  const counter = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const attention = useRef(false);
  attention.current = Boolean(balloon || menu || dialog);

  const later = useCallback((ms: number, run: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  const sounds = useMemo(() => createRetroSounds(() => prefsRef.current.options.sounds), []);
  useEffect(() => () => sounds.close(), [sounds]);

  const character = prefs.character;
  const look = lookById(prefs.look);
  const box = characterBox(character);
  const size = Math.max(box.width, box.height);
  const position = prefs.position ?? perch;
  const custom = useCustomArtUrls(character === "custom" || dialog === "gallery" || dialog === "custom", artVersion);
  const names = characterStrings(character);

  const bridge = typeof window === "undefined" ? undefined : window.ogb?.retroAssistant;
  const detached = Boolean(bridge) && prefs.detached && !leaving;

  const play = useCallback((name: Act["name"], ms: number) => {
    counter.current += 1;
    const n = counter.current;
    setAct({ name, n });
    later(ms, () => setAct((current) => (current?.n === n ? null : current)));
  }, [later]);

  const sendEnvelope = useCallback(() => {
    counter.current += 1;
    const n = counter.current;
    setEnvelopes((list) => [...list, n]);
    later(plan.travel ? 3600 : 1800, () => setEnvelopes((list) => list.filter((value) => value !== n)));
  }, [later, plan.travel]);

  const lookAround = useCallback(() => {
    const steps: Array<[number, OwlGaze | undefined]> = [
      [0, { x: -1, y: 0 }],
      [700, { x: 1, y: -0.3 }],
      [1400, { x: -0.6, y: 0.4 }],
      [2100, undefined],
    ];
    for (const [at, value] of steps) later(at, () => setGaze(value));
    if (plan.travel) play("lookAround", 2200);
  }, [later, play, plan.travel]);

  const runAnimation = useCallback((name: RetroAnimation) => {
    switch (name) {
      case "flap":
      case "spread":
      case "hoot":
      case "shake":
      case "takeoff":
        owl.current?.flourish(name);
        if (prefsRef.current.character !== "owl") play("celebrate", 1300);
        sounds.play(name === "hoot" ? "chime" : "pop");
        break;
      case "tap":
        if (plan.travel) play("tap", 1100);
        sounds.play("tap");
        break;
      case "lookAround":
        lookAround();
        break;
      case "yawn":
        owl.current?.play("sleepy", 2200);
        if (plan.travel) play("yawn", 2200);
        break;
      case "envelope":
        owl.current?.flourish("flap");
        sendEnvelope();
        sounds.play("whoosh");
        break;
    }
  }, [lookAround, play, plan.travel, sendEnvelope, sounds]);

  const openBalloon = useCallback((next: Balloon, sound: "pop" | null = "pop") => {
    setBulb(null);
    setMenu(null);
    setBalloon(next);
    if (sound) sounds.play(sound);
    lastActivity.current = Date.now();
    setMood("awake");
  }, [sounds]);

  const openTip = useCallback((tip: RetroTip | null) => {
    if (!tip) return;
    lastTipAt.current = Date.now();
    lastTipId.current = tip.id;
    openBalloon({ kind: "tip", tip });
  }, [openBalloon]);

  const pickTip = useCallback(() => nextTip(prefsRef.current.options, prefsRef.current.dismissed, lastTipId.current), []);

  /** The era's eager interruption: perk up, tap the glass, then ask. */
  const tryGuess = useCallback((kind: GuessKind) => {
    const now = Date.now();
    const gate = { now, options: prefsRef.current.options, dismissed: prefsRef.current.dismissed, lastAt: lastGuess.current, busy: attention.current };
    if (!mayGuess(kind, gate)) return;
    lastGuess.current = { ...lastGuess.current, [kind]: now };
    owl.current?.play("alert", 700);
    if (plan.travel) play("tap", 1100);
    sounds.play("tap");
    later(reduced ? 0 : 650, () => {
      if (!attention.current) openBalloon({ kind: "guess", guess: RETRO_GUESSES[kind] });
    });
  }, [later, openBalloon, play, plan.travel, reduced, sounds]);

  const runAction = useCallback((action: TipAction) => {
    setBalloon(null);
    switch (action) {
      case "shortcuts":
        dispatch({ type: "toggleShortcuts", open: true });
        break;
      case "appearance":
        dispatch({ type: "toggleAppSettings", open: true, section: "appearance" });
        break;
      case "botPanel":
        dispatch({ type: "toggleSettings", open: true });
        break;
      case "plugins":
        dispatch({ type: "togglePlugins", open: true, surface: "mcp" });
        break;
      case "routines":
        dispatch({ type: "showRoutines" });
        break;
      case "gallery":
      case "options":
        setDialog(action);
        break;
    }
  }, [dispatch]);

  const dismiss = useCallback((entry: string) => {
    setPrefs((current) => (current.dismissed.includes(entry) ? current : { ...current, dismissed: [...current.dismissed, entry] }));
  }, [setPrefs]);

  const runSearch = useCallback((text: string) => {
    const found = searchTips(text, (tip) => t(tip.text));
    sounds.play("click");
    openBalloon({ kind: "results", query: text, tips: found }, null);
  }, [openBalloon, sounds]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    runSearch(query);
  };

  const busyIds = state.bots.filter((bot) => bot.busy).map((bot) => bot.id).join(",");
  useRetroAssistantActivity({
    leaving, fresh, onGone, reduced, plan, sounds, later, play, runAnimation, lookAround,
    tryGuess, openBalloon, openTip, pickTip, owl, prefsRef, lastActivity, lastTipAt, lastTipId,
    longArmed, attention, size, balloon, bulb, menu, dialog, mood, setBalloon, setBulb, setMenu,
    setDialog, setMood, setPerch, setPrefsState, busyIds, selectedId: state.selectedId,
  });

  const {
    dragPos, clickCharacter, onPointerDown, onPointerMove, onPointerUp,
    onPointerCancel, onContextMenu, onCharacterKey,
  } = useRetroAssistantDrag({
    position, size, balloon, bulb, sounds, setBalloon, setMenu, setPrefs, openTip, openBalloon,
  });

  const at = dragPos ?? position;
  const stageTop = typeof window === "undefined" ? 600 : window.innerHeight - at.bottom - box.height;
  const balloonBelow = stageTop < 300;

  const busy = state.bots.some((bot) => bot.busy);
  const pose = assistantPose({
    act: act?.name,
    sending: envelopes.length > 0,
    busy,
    mood,
    talking: Boolean(balloon),
  });

  const menuItems = useMemo(() => {
    return assistantMenu(Boolean(bridge), prefs.detached).map((item) => ({ ...item, label: t(item.label) }));
    // language changes the labels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, prefs.detached, language]);

  const pickMenu = useCallback((item: MenuItem) => {
    setMenu(null);
    sounds.play("click");
    if (item === "hide") setRetroEnabled(false);
    else if (item === "options") setDialog("options");
    else if (item === "gallery") setDialog("gallery");
    else if (item === "detach") setPrefs((current) => ({ ...current, detached: true }));
    else if (item === "attach") setPrefs((current) => ({ ...current, detached: false }));
    else runAnimation(RANDOM_ANIMATIONS[Math.floor(Math.random() * RANDOM_ANIMATIONS.length)]);
  }, [runAnimation, setPrefs, sounds]);

  const model: BalloonModel | null = useMemo(
    () => buildBalloonModel({
      balloon,
      welcomeKey: names.welcome,
      openTip,
      pickTip,
      runAction,
      dismiss,
      setBalloon,
      setDialog,
    }),
    // language changes every label
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balloon, dismiss, names.welcome, openTip, pickTip, runAction, language],
  );

  const snapshot: DetachedSnapshot | null = detached
    ? {
        v: 1,
        character,
        pose,
        reduced,
        locale: language,
        label: t(names.aria),
        bulb: bulb && !balloon ? t("retro.bulb") : null,
        look: character === "owl" ? { color: look.color, skin: look.skin } : null,
        menu: menuItems.map((item) => ({ id: item.id, label: item.label })),
        balloon: model
          ? {
              title: model.tipHead ? t("retro.tip.title") : undefined,
              text: model.text,
              question: model.question,
              bullets: model.bullets.map(({ id, label }) => ({ id, label })),
              buttons: model.buttons.map(({ id, label, primary }) => ({ id, label, ...(primary ? { default: true } : {}) })),
              ask: model.ask ? { label: t("retro.ask.label"), placeholder: t("retro.ask.placeholder"), search: t("retro.ask.search"), options: t("retro.ask.options") } : undefined,
            }
          : null,
      }
    : null;

  useRetroAssistantDetached({
    bridge, detached, prefsRef, setPrefs, setBalloon, setDialog,
    model, clickCharacter, pickMenu, runSearch, bulb, openTip, snapshot,
  });

  return (
    <RetroAssistantChrome
      reduced={reduced}
      language={language}
      detached={detached}
      leaving={leaving}
      character={character}
      pose={pose}
      mood={mood}
      act={act}
      box={box}
      at={at}
      balloonBelow={balloonBelow}
      look={{ color: look.color, skin: look.skin }}
      gaze={gaze}
      custom={custom}
      owl={owl}
      busy={busy}
      planTravel={plan.travel}
      planExit={plan.exit}
      envelopes={envelopes}
      bulb={bulb}
      balloon={balloon}
      model={model}
      query={query}
      setQuery={setQuery}
      namesAria={t(names.aria)}
      soundsClick={() => sounds.play("click")}
      openTip={openTip}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenu}
      onCharacterKey={onCharacterKey}
      onSearch={search}
      onAskOptions={() => { setBalloon(null); setDialog("options"); }}
    >
      {menu && <OwlMenu at={menu} items={menuItems} onClose={() => setMenu(null)} onPick={pickMenu} />}

      {dialog === "options" && (
        <OptionsDialog
          options={prefs.options}
          onReset={() => setPrefs((current) => ({ ...current, dismissed: [] }))}
          onClose={() => setDialog(null)}
          onSave={(options) => {
            setPrefs((current) => ({ ...current, options }));
            setDialog(null);
          }}
        />
      )}
      {dialog === "gallery" && (
        <GalleryDialog
          character={prefs.character}
          look={prefs.look}
          custom={custom}
          onClose={() => setDialog(null)}
          onCustomize={() => setDialog("custom")}
          onPick={(choice) => {
            setPrefs((current) => ({ ...current, character: choice.character, look: choice.look ?? current.look }));
            setDialog(null);
            later(50, () => owl.current?.flourish("spread"));
            sounds.play("chime");
          }}
        />
      )}
      {dialog === "custom" && (
        <CustomAssistantDialog
          custom={custom}
          onChanged={() => setArtVersion((value) => value + 1)}
          onClose={() => setDialog("gallery")}
          onUse={() => {
            setPrefs((current) => ({ ...current, character: "custom" }));
            setDialog(null);
          }}
        />
      )}
    </RetroAssistantChrome>
  );
}
