// The stage of a bot's large mascot (#5384): what the open-bot-avatar site's
// stage does (apps/site/src/studio/Stage.tsx, 0.5.1), on the button that
// holds the mascot. Drag turns the body (the gaze held meanwhile), the arrow
// keys turn it too, Home, 0, Escape or a double click bring it back over
// 420 ms (at once under reduced motion), 1 to 6 preview a state and M changes
// the mood. A press that barely moved stays a click: it still opens what the
// button opens (mascot-turn.ts, CLICK_SLOP).
//
// The site's stage has no click, so its double click only turns the body
// back. Here the button opens the picker, and a double click is two clicks
// first: on a turned mascot a click waits DOUBLE_CLICK_MS for a second one,
// so the double click brings the mascot back and leaves the picker as it was,
// as Reset view does. Facing front, a click is a click at once.
//
// Only a shape is turned: the other characters are flat drawings with no
// volume to turn, and a picture is a picture. The state a key previews is
// never stored: it shows until the mascot loses the focus, then the bot's
// own state is back.
//
// The stage is the mascot and its Reset view button, side by side in one
// wrapper ([data-mascot-turn]); on the site the button sits inside the stage.
// So the mascot's keys work from the button too, a previewed state lasts while
// the focus is on either, and the button never keeps a focus it is about to
// hide with: it hands it to the mascot. Escape is the mascot's while it has
// something to cancel (a turn, a previewed state); with nothing to cancel it
// is left to what closed on it before (the picker, then the page).
// The button hides once the mascot faces front, wherever the focus is then: on
// its way back the button is out of the Tab order, and a focus still on it
// when it hides goes to the mascot. A double click on the button is one way
// back and nothing else: its second click, which lands on the mascot once the
// button is gone, is no click on the mascot.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { AvatarState } from "open-bot-avatar";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import type { ShapeStage } from "@/components/shape-stage";
import { materialsSupported } from "@/components/shape-material";
import { useReducedMotion } from "@/components/skin-fx/skin-fx";
import { RotateCcw } from "lucide-react";
import { botMascotLook, engineLookOf, type MascotLook, type ShapeMoodSetting } from "../../../shared/mascot-look";
import { pickerColor } from "./mascot-picker";
import type { MausColor } from "@/lib/mascot";
import { FRONT, dragView, isDrag, isTurned, keyAction, resetView, wrapYaw, RESET_MS, type ViewAngle } from "./mascot-turn";

/** How long a click on a turned mascot waits for the second click of a double click. */
const DOUBLE_CLICK_MS = 250;
const MOODS: readonly ShapeMoodSetting[] = ["neutral", "happy"];
const STATE_LABEL: Readonly<Record<string, LocaleKey>> = {
  idle: "mascotStage.state.idle",
  thinking: "mascotStage.state.thinking",
  working: "mascotStage.state.working",
  waiting: "mascotStage.state.waiting",
  blocked: "mascotStage.state.blocked",
  done: "mascotStage.state.done",
};
const MOOD_LABEL: Readonly<Record<ShapeMoodSetting, LocaleKey>> = { neutral: "appearance.mood.neutral", happy: "appearance.mood.happy" };

/** Whether a look is turned by hand: a shape worn as the mascot (never one of the other characters, never a picture). */
export function turnsByHand(look: MascotLook | null | undefined, picture = false): boolean {
  return !picture && botMascotLook(look).character === "shape";
}

export interface MascotTurn {
  /** What the shape inside reads (ShapeStageContext); null where nothing is turned. */
  stage: ShapeStage | null;
  /** The handlers of the element that holds the mascot (a button). */
  handlers: {
    onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel?: (event: PointerEvent<HTMLElement>) => void;
    onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
    onDoubleClick?: () => void;
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
    onBlur?: (event: FocusEvent<HTMLElement>) => void;
  };
  enabled: boolean;
  dragging: boolean;
  turned: boolean;
  /** On its way back to the front (the 420 ms). */
  returning: boolean;
  reset: () => void;
  /** The Reset view button was pressed: the second click of a double click on it is not the mascot's. */
  resetPressed: () => void;
  /** What a key just picked, for screen readers. */
  said: string;
}

export function useMascotTurn({ look, picture = false, onMood, small = false }: { look: MascotLook | null | undefined; picture?: boolean; onMood?: ((mood: ShapeMoodSetting) => void) | undefined; /** Drawn under the live size (shape-stage.ts, `small`). */ small?: boolean }): MascotTurn {
  const enabled = turnsByHand(look, picture);
  const settings = engineLookOf(look);
  const systemReduced = useReducedMotion();
  const reduced = settings.motion === "reduced" || (settings.motion === "system" && systemReduced);

  const [view, setView] = useState<ViewAngle>(FRONT);
  const [dragging, setDragging] = useState(false);
  const [returning, setReturning] = useState(false);
  const [previewState, setPreviewState] = useState<AvatarState | null>(null);
  const [said, setSaid] = useState("");
  const current = useRef(view);
  current.current = view;
  const press = useRef<{ id: number; x: number; y: number; start: ViewAngle; dragged: boolean } | null>(null);
  const swallowClick = useRef(false);
  // the click a turned mascot holds until it knows whether a second one follows (0: none)
  const heldClick = useRef(0);
  const replaying = useRef(false);
  // the last press was on the Reset view button: a click counted as the second or third of a multiple click is its echo
  const afterReset = useRef(false);
  const dropHeldClick = () => {
    window.clearTimeout(heldClick.current);
    heldClick.current = 0;
  };
  const easing = useRef(0);
  const stopEasing = () => {
    cancelAnimationFrame(easing.current);
    setReturning(false);
  };
  // stops listening for the release of a press the mascot may never see
  const unwatch = useRef<(() => void) | null>(null);
  useEffect(() => () => { cancelAnimationFrame(easing.current); window.clearTimeout(heldClick.current); unwatch.current?.(); }, []);
  // a look that is no longer a shape faces front again
  useEffect(() => {
    if (enabled) return;
    stopEasing();
    setView(FRONT);
    setPreviewState(null);
    setDragging(false);
  }, [enabled]);

  const turned = isTurned(view);
  const reset = () => {
    stopEasing();
    if (reduced) return setView(FRONT);
    const from = current.current;
    const start = performance.now();
    const step = (now: number) => {
      const next = resetView(from, now - start);
      setView(next);
      if (now - start < RESET_MS) easing.current = requestAnimationFrame(step);
      else setReturning(false);
    };
    setReturning(true);
    easing.current = requestAnimationFrame(step);
  };
  const resetPressed = () => { afterReset.current = true; };

  const stage = useMemo<ShapeStage | null>(() => (enabled ? { view, holdGaze: dragging, previewState, ...(small ? { small } : {}) } : null), [enabled, view, dragging, previewState, small]);
  if (!enabled) return { stage: null, handlers: {}, enabled, dragging: false, turned: false, returning: false, reset, resetPressed, said: "" };

  const end = (event: PointerEvent<HTMLElement>) => {
    const held = press.current;
    if (!held || held.id !== event.pointerId) return;
    press.current = null;
    if (!held.dragged) return;
    setDragging(false);
    setView((at) => ({ yaw: wrapYaw(at.yaw), pitch: at.pitch }));
    // the click that ends a drag is not a click on the mascot
    swallowClick.current = true;
    window.setTimeout(() => { swallowClick.current = false; }, 0);
  };

  return {
    stage,
    enabled,
    dragging,
    turned,
    returning,
    reset,
    resetPressed,
    said,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        stopEasing();
        const id = event.pointerId;
        press.current = { id, x: event.clientX, y: event.clientY, start: current.current, dragged: false };
        // Until a drag begins the mascot does not hold the pointer, so its release may land elsewhere (the pointer
        // left in one move, a menu opened under it): the press is over all the same, or the pointer coming back
        // over the mascot would turn it with no button down.
        unwatch.current?.();
        const released = (up: globalThis.PointerEvent) => {
          if (up.pointerId !== id) return;
          unwatch.current?.();
          if (press.current?.id === id && !press.current.dragged) press.current = null;
        };
        unwatch.current = () => {
          window.removeEventListener("pointerup", released, true);
          window.removeEventListener("pointercancel", released, true);
          unwatch.current = null;
        };
        window.addEventListener("pointerup", released, true);
        window.addEventListener("pointercancel", released, true);
      },
      onPointerMove: (event) => {
        const held = press.current;
        if (!held || held.id !== event.pointerId) return;
        const dx = event.clientX - held.x;
        const dy = event.clientY - held.y;
        if (!held.dragged) {
          if (!isDrag(dx, dy)) return;
          held.dragged = true;
          // the drag goes on outside the mascot
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* a pointer already gone */ }
          setDragging(true);
        }
        setView(dragView(held.start, dx, dy));
      },
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture: (event) => {
        if (swallowClick.current) {
          swallowClick.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // The echo of a press on the Reset view button: the button hides once the mascot faces front, so the
        // second click of a double click on it lands here. It is no click on the mascot.
        if (afterReset.current && event.detail >= 2) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        afterReset.current = false;
        // at once: the held click played, a key's click (no second one follows it), a mascot facing front
        if (replaying.current || event.detail === 0) return;
        if (!heldClick.current && !isTurned(current.current)) return;
        event.preventDefault();
        event.stopPropagation();
        const button = event.currentTarget;
        const play = () => {
          dropHeldClick();
          replaying.current = true;
          try { button.click(); } finally { replaying.current = false; }
        };
        if (heldClick.current) {
          // the second click of a double click: the dblclick that follows drops the first
          if (event.detail >= 2) return;
          // a click of its own (no double click for the browser): the held one is played now, this one waits in its turn
          play();
        }
        heldClick.current = window.setTimeout(play, DOUBLE_CLICK_MS);
      },
      onDoubleClick: () => {
        dropHeldClick();
        if (isTurned(current.current)) reset();
      },
      onKeyDown: (event) => {
        const action = keyAction(event, current.current);
        // Escape brings the mascot back to itself: the state a key previews goes with the turn, or alone
        if (event.key === "Escape" && previewState) {
          event.preventDefault();
          setPreviewState(null);
          setSaid("");
        }
        if (!action) return;
        if (action.kind === "mood" && !onMood) return;
        event.preventDefault();
        if (action.kind === "reset") return reset();
        if (action.kind === "view") {
          stopEasing();
          return setView(action.view);
        }
        if (action.kind === "state") {
          setPreviewState(action.state);
          return setSaid(t(STATE_LABEL[action.state]!));
        }
        const next = MOODS[(MOODS.indexOf(settings.mood) + action.step + MOODS.length) % MOODS.length]!;
        onMood?.(next);
        setSaid(t(MOOD_LABEL[next]));
      },
      // the preview lasts while the focus is on the stage: the mascot or its Reset view button
      onBlur: (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.closest("[data-mascot-turn]")?.contains(next)) return;
        setPreviewState(null);
      },
    },
  };
}

/** The class of the element that holds a mascot turned by hand: the open hand, the closed one while it is dragged. */
export function turnCursor(turn: Pick<MascotTurn, "enabled" | "dragging">): string | undefined {
  return turn.enabled ? cn("touch-none select-none", turn.dragging ? "cursor-grabbing" : "cursor-grab") : undefined;
}

/** The mascot of the stage a Reset view button belongs to: the other button of its wrapper. */
function focusMascot(reset: HTMLElement) {
  reset.closest("[data-mascot-turn]")?.querySelector<HTMLElement>("button:not([data-mascot-turn-reset])")?.focus({ preventScroll: true });
}

/**
 * Shown while the mascot is turned: brings it back to the front (the site's
 * "Reset view"). It hides once the mascot faces front, so it never keeps the
 * focus through its own press or a key: the mascot takes it first, or the
 * focus would fall to the document and the next Escape would close the page.
 */
export function MascotTurnReset({ turn, className }: { turn: MascotTurn; className?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  // whatever brought the mascot back (its own keys, a double click, the end of a drag), a focus still on the
  // button when it hides goes to the mascot, before the browser drops it on the document
  useLayoutEffect(() => {
    if (!turn.turned && button.current && document.activeElement === button.current) focusMascot(button.current);
  }, [turn.turned]);
  if (!turn.enabled) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        data-mascot-turn-reset=""
        onClick={(event) => {
          focusMascot(event.currentTarget);
          turn.resetPressed();
          turn.reset();
        }}
        // the mascot's keys, as on the site where the button is inside the stage; Enter and Space stay the button's
        onKeyDown={(event) => {
          turn.handlers.onKeyDown?.(event);
          if (event.defaultPrevented) focusMascot(event.currentTarget);
        }}
        onBlur={turn.handlers.onBlur}
        aria-label={t("mascotStage.reset")}
        title={t("mascotStage.reset")}
        hidden={!turn.turned}
        // on its way back the button is about to hide: Tab passes it
        tabIndex={turn.turned && !turn.returning ? 0 : -1}
        className={cn("absolute grid size-7 place-items-center rounded-full border border-hairline bg-panel text-ink-secondary outline-none hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent", className)}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </button>
      <span className="sr-only" role="status" data-mascot-turn-said="">{turn.said}</span>
    </>
  );
}

/**
 * Under a glass body on a stage: the soft glow of its own colour the engine's
 * site lays there (its stage-glass-caustic), sized to the mascot. Never under
 * a mark (thinking, blocked: the body has given way), nor where the device
 * draws the body flat.
 */
export function MascotGlassCaustic({ turn, bot, state }: { turn: MascotTurn; bot: { color: MausColor; mascotLook?: MascotLook | null | undefined }; state: AvatarState }) {
  if (!turn.enabled || engineLookOf(bot.mascotLook).material !== "glass" || !materialsSupported()) return null;
  const shown = turn.stage?.previewState ?? state;
  if (shown === "thinking" || shown === "blocked") return null;
  return <span aria-hidden="true" data-mascot-glass-caustic="" className="mascot-glass-caustic" style={{ "--glass-tint": pickerColor(bot).hex } as CSSProperties} />;
}
