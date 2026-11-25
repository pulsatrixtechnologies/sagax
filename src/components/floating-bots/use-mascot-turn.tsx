// The stage of a bot's large mascot (#5384): what the open-bot-avatar site's
// stage does (apps/site/src/studio/Stage.tsx, 0.5.1), on the button that
// holds the mascot. Drag turns the body (the gaze held meanwhile), the arrow
// keys turn it too, Home, 0, Escape or a double click bring it back over
// 420 ms (at once under reduced motion), 1 to 6 preview a state and M changes
// the mood. A press that barely moved stays a click: it still opens what the
// button opens (mascot-turn.ts, CLICK_SLOP).
//
// Only a shape is turned: the other characters are flat drawings with no
// volume to turn, and a picture is a picture. The state a key previews is
// never stored: it shows until the mascot loses the focus, then the bot's
// own state is back.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { AvatarState } from "open-bot-avatar";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import type { ShapeStage } from "@/components/shape-stage";
import { useReducedMotion } from "@/components/skin-fx/skin-fx";
import { RotateCcw } from "lucide-react";
import { botMascotLook, engineLookOf, type MascotLook, type ShapeMoodSetting } from "../../../shared/mascot-look";
import { FRONT, dragView, isDrag, isTurned, keyAction, resetView, wrapYaw, RESET_MS, type ViewAngle } from "./mascot-turn";

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
    onBlur?: () => void;
  };
  enabled: boolean;
  dragging: boolean;
  turned: boolean;
  reset: () => void;
  /** What a key just picked, for screen readers. */
  said: string;
}

export function useMascotTurn({ look, picture = false, onMood }: { look: MascotLook | null | undefined; picture?: boolean; onMood?: ((mood: ShapeMoodSetting) => void) | undefined }): MascotTurn {
  const enabled = turnsByHand(look, picture);
  const settings = engineLookOf(look);
  const systemReduced = useReducedMotion();
  const reduced = settings.motion === "reduced" || (settings.motion === "system" && systemReduced);

  const [view, setView] = useState<ViewAngle>(FRONT);
  const [dragging, setDragging] = useState(false);
  const [previewState, setPreviewState] = useState<AvatarState | null>(null);
  const [said, setSaid] = useState("");
  const current = useRef(view);
  current.current = view;
  const press = useRef<{ id: number; x: number; y: number; start: ViewAngle; dragged: boolean } | null>(null);
  const swallowClick = useRef(false);
  const easing = useRef(0);
  useEffect(() => () => cancelAnimationFrame(easing.current), []);
  // a look that is no longer a shape faces front again
  useEffect(() => {
    if (enabled) return;
    cancelAnimationFrame(easing.current);
    setView(FRONT);
    setPreviewState(null);
    setDragging(false);
  }, [enabled]);

  const turned = isTurned(view);
  const reset = () => {
    cancelAnimationFrame(easing.current);
    if (reduced) return setView(FRONT);
    const from = current.current;
    const start = performance.now();
    const step = (now: number) => {
      const next = resetView(from, now - start);
      setView(next);
      if (now - start < RESET_MS) easing.current = requestAnimationFrame(step);
    };
    easing.current = requestAnimationFrame(step);
  };

  const stage = useMemo<ShapeStage | null>(() => (enabled ? { view, holdGaze: dragging, previewState } : null), [enabled, view, dragging, previewState]);
  if (!enabled) return { stage: null, handlers: {}, enabled, dragging: false, turned: false, reset, said: "" };

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
    reset,
    said,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        cancelAnimationFrame(easing.current);
        press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: current.current, dragged: false };
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
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
      onDoubleClick: () => { if (isTurned(current.current)) reset(); },
      onKeyDown: (event) => {
        const action = keyAction(event, current.current);
        if (!action) return;
        if (action.kind === "mood" && !onMood) return;
        event.preventDefault();
        if (action.kind === "reset") return reset();
        if (action.kind === "view") {
          cancelAnimationFrame(easing.current);
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
      onBlur: () => setPreviewState(null),
    },
  };
}

/** The class of the element that holds a mascot turned by hand: the open hand, the closed one while it is dragged. */
export function turnCursor(turn: Pick<MascotTurn, "enabled" | "dragging">): string | undefined {
  return turn.enabled ? cn("touch-none select-none", turn.dragging ? "cursor-grabbing" : "cursor-grab") : undefined;
}

/** Shown while the mascot is turned: brings it back to the front (the site's "Reset view"). */
export function MascotTurnReset({ turn, className }: { turn: MascotTurn; className?: string }) {
  if (!turn.enabled) return null;
  return (
    <>
      <button
        type="button"
        data-mascot-turn-reset=""
        onClick={turn.reset}
        aria-label={t("mascotStage.reset")}
        title={t("mascotStage.reset")}
        hidden={!turn.turned}
        tabIndex={turn.turned ? 0 : -1}
        className={cn("absolute grid size-7 place-items-center rounded-full border border-hairline bg-panel text-ink-secondary outline-none hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent", className)}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </button>
      <span className="sr-only" role="status" data-mascot-turn-said="">{turn.said}</span>
    </>
  );
}
