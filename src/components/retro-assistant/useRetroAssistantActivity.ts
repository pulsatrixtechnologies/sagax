import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { OwlAvatarHandle } from "@/components/OwlAvatar";
import { onRetroSignal } from "@/lib/retro98";
import {
  BIG_PASTE_CHARS,
  LONG_MESSAGE_CHARS,
  clampPosition,
  idlePhase,
  nextTip,
  type GuessKind,
  type IdlePhase,
  type RetroAnimation,
  type RetroPrefs,
  type RetroTip,
} from "./logic";
import type { createRetroSounds } from "./sounds";
import { TIP_EVERY_MS, inComposer, perchAboveComposer, type Act, type Balloon } from "./retro-assistant-shared";

type Sounds = ReturnType<typeof createRetroSounds>;
type MotionPlan = { travel: boolean; exit: "puff" | "vanish" };

export interface RetroActivityArgs {
  leaving: boolean;
  fresh: boolean;
  onGone?: () => void;
  reduced: boolean;
  plan: MotionPlan;
  sounds: Sounds;
  later: (ms: number, run: () => void) => void;
  play: (name: Act["name"], ms: number) => void;
  runAnimation: (name: RetroAnimation) => void;
  lookAround: () => void;
  tryGuess: (kind: GuessKind) => void;
  openBalloon: (next: Balloon, sound?: "pop" | null) => void;
  openTip: (tip: RetroTip | null) => void;
  pickTip: () => RetroTip | null;
  owl: RefObject<OwlAvatarHandle | null>;
  prefsRef: MutableRefObject<RetroPrefs>;
  lastActivity: MutableRefObject<number>;
  lastTipAt: MutableRefObject<number>;
  lastTipId: MutableRefObject<string | null>;
  longArmed: MutableRefObject<boolean>;
  attention: MutableRefObject<boolean>;
  size: number;
  balloon: Balloon | null;
  bulb: RetroTip | null;
  menu: { x: number; y: number } | null;
  dialog: "options" | "gallery" | "custom" | null;
  mood: IdlePhase;
  setBalloon: Dispatch<SetStateAction<Balloon | null>>;
  setBulb: Dispatch<SetStateAction<RetroTip | null>>;
  setMenu: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setDialog: Dispatch<SetStateAction<"options" | "gallery" | "custom" | null>>;
  setMood: Dispatch<SetStateAction<IdlePhase>>;
  setPerch: Dispatch<SetStateAction<{ right: number; bottom: number }>>;
  setPrefsState: Dispatch<SetStateAction<RetroPrefs>>;
  busyIds: string;
  selectedId: string | null;
}

/** Entrance, exit, composer guesses, idle tips and perch, and mood reactions. */
export function useRetroAssistantActivity(args: RetroActivityArgs): void {
  const {
    leaving, fresh, onGone, reduced, plan, sounds, later, play, runAnimation, lookAround,
    tryGuess, openBalloon, openTip, pickTip, owl, prefsRef, lastActivity, lastTipAt, lastTipId,
    longArmed, attention, size, balloon, bulb, menu, dialog, mood, setBalloon, setBulb, setMenu,
    setDialog, setMood, setPerch, setPrefsState, busyIds, selectedId,
  } = args;

  useEffect(() => {
    // The switch was a keypress or a send, so the page has seen a gesture:
    // sounds may start now. Otherwise they wait for the first interaction.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation?.hasBeenActive) sounds.unlock();
    play("enter", reduced ? 200 : 1100);
    sounds.play("hello");
    if (fresh) later(reduced ? 150 : 1000, () => openBalloon({ kind: "welcome" }));
    else if (prefsRef.current.options.startupTip) later(reduced ? 150 : 1200, () => openTip(pickTip()));
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leaving) return;
    setBalloon(null);
    setMenu(null);
    setDialog(null);
    setBulb(null);
    play("leave", 900);
    sounds.play("bye");
    later(plan.exit === "puff" ? 750 : 120, () => onGone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  useEffect(() => {
    const unlock = () => sounds.unlock();
    const activity = () => {
      lastActivity.current = Date.now();
      setMood((current) => {
        if (current === "doze") {
          owl.current?.play("alert", 900);
          later(600, () => tryGuess("idle"));
        }
        return current === "awake" ? current : "awake";
      });
    };
    const onKey = (event: KeyboardEvent) => {
      // Some hosts emit synthetic "Unidentified" keys; they are nobody typing.
      if (event.key === "Unidentified") return;
      unlock();
      activity();
      if (event.key !== "Escape") return;
      if (menu) setMenu(null);
      else if (dialog) setDialog(null);
      else if (balloon) setBalloon(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!inComposer(event.target)) return;
      // Wait a beat: a guess prompted by the same moment (a conversation
      // switch focuses the composer too) is the better thing to say.
      later(900, () => {
        if (attention.current) return;
        if (bulb) openTip(bulb);
        else if (Date.now() - lastTipAt.current > TIP_EVERY_MS) openTip(pickTip());
      });
    };
    const onInput = (event: Event) => {
      activity();
      const target = event.target;
      if (!inComposer(target) || !(target instanceof HTMLTextAreaElement)) return;
      const length = target.value.length;
      if (length < 20) longArmed.current = true;
      if (length >= LONG_MESSAGE_CHARS && longArmed.current) {
        longArmed.current = false;
        tryGuess("longMessage");
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!inComposer(event.target)) return;
      const text = event.clipboardData?.getData("text") ?? "";
      if (text.length >= BIG_PASTE_CHARS) later(250, () => tryGuess("paste"));
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("pointermove", activity, { passive: true });
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("input", onInput, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("pointermove", activity);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, [balloon, bulb, dialog, later, menu, openTip, pickTip, sounds, tryGuess, attention, lastActivity, lastTipAt, longArmed, owl, setBalloon, setDialog, setMenu, setMood]);

  useEffect(
    () =>
      onRetroSignal((kind) => {
        if (kind === "send") {
          longArmed.current = true;
          setBalloon((current) => (current?.kind === "guess" && current.guess.kind === "longMessage" ? null : current));
          runAnimation("envelope");
        } else if (kind === "tip") {
          openTip(pickTip());
        } else if (kind === "gallery" || kind === "options") {
          setBalloon(null);
          setDialog(kind);
        }
      }),
    [openTip, pickTip, runAnimation, longArmed, setBalloon, setDialog],
  );

  // Idle cycle, the waiting tip and the perch, on one slow clock.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      if (attention.current || leaving) lastActivity.current = now;
      const next = idlePhase(now - lastActivity.current);
      setMood((current) => (current === next ? current : next));
      if (!attention.current && !leaving && now - lastTipAt.current > TIP_EVERY_MS) {
        lastTipAt.current = now;
        const tip = nextTip(prefsRef.current.options, prefsRef.current.dismissed, lastTipId.current);
        if (tip) {
          lastTipId.current = tip.id;
          setBulb(tip);
          sounds.play("bulb");
        }
      }
      if (!prefsRef.current.position) {
        const spot = perchAboveComposer();
        setPerch((current) => (current.right === spot.right && current.bottom === spot.bottom ? current : spot));
      }
    }, 1000);
    lastTipAt.current = Date.now();
    return () => clearInterval(tick);
  }, [leaving, sounds, attention, lastActivity, lastTipAt, lastTipId, prefsRef, setBulb, setMood, setPerch]);

  // What each idle step does, once, as it begins.
  useEffect(() => {
    if (mood === "look") lookAround();
    if (mood === "yawn") {
      owl.current?.play("sleepy", 2400);
      if (plan.travel) play("yawn", 2400);
    }
    if (mood !== "bored") return;
    runAnimation("tap");
    const again = setInterval(() => runAnimation("tap"), 4000);
    return () => clearInterval(again);
  }, [lookAround, mood, play, plan.travel, runAnimation, owl]);

  // Think while any bot works; celebrate when one finishes a reply.
  const previousBusy = useRef(busyIds);
  useEffect(() => {
    const before = previousBusy.current ? previousBusy.current.split(",") : [];
    const now = busyIds ? busyIds.split(",") : [];
    previousBusy.current = busyIds;
    if (before.some((id) => !now.includes(id))) {
      owl.current?.flourish("spread");
      owl.current?.play("success");
      play("celebrate", plan.travel ? 2600 : 1600);
      sounds.play("chime");
    }
  }, [busyIds, play, plan.travel, sounds, owl]);

  // Switching conversations is a reason to offer a shortcut.
  const previousSelected = useRef(selectedId);
  useEffect(() => {
    if (previousSelected.current === selectedId) return;
    previousSelected.current = selectedId;
    tryGuess("switch");
  }, [selectedId, tryGuess]);

  useLayoutEffect(() => {
    const onResize = () => {
      setPerch(perchAboveComposer());
      if (prefsRef.current.position) {
        const clamped = clampPosition(prefsRef.current.position, { width: window.innerWidth, height: window.innerHeight }, size);
        setPrefsState((current) => ({ ...current, position: clamped }));
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size, prefsRef, setPerch, setPrefsState]);
}
