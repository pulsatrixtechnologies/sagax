// The floating bot's stage: the character (or away badge), its effects, hover
// controls, captions and call/reply pills. Owns pointer drag, stroke and click.
import { useEffect, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from "react";
import type { MascotActivity, MascotInput } from "./behavior";
import { mascotMotion } from "./behavior";
import { clickGesture, eventsForClick, strokeLeave, strokeStep, type StrokeState } from "./gestures";
import { CAPTIONS_WIDTH, MascotCaptions, MascotHoverControls } from "./MascotControls";
import { MascotCallPill, type LevelSource, type MascotCallCard } from "./MascotCall";
import { ReplyPill, usesReplyBubble } from "./ReplyBubble";
import { DRAG_SLOP as CLICK_SLOP, hoverControlsShown, isDrag, mascotClick } from "./hover-controls";
import { effectLane, pillTop, type EffectSide, type PillSide } from "./placement";
import type { FloatingEvent, FloatingSnapshot } from "./protocol";
import { AwayBadge, Character, StageEffects } from "./FloatingBotDecor";
import type { DragState } from "./use-mascot-life";
import type { FloatingMover } from "./floating-view-types";
import { OWL_BOX, OWL_SIZE, STAGE } from "./stage-size";

const DRAG_SLOP = CLICK_SLOP;
/** A press held this long opens the menu where there is no right click (touch). */
const LONG_PRESS_MS = 550;
const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

export interface FloatingBotStageProps {
  snapshot: FloatingSnapshot;
  onEvent: (event: FloatingEvent) => void;
  mover: FloatingMover;
  interactive?: (on: boolean) => void;
  wantsKeyboard?: (on: boolean) => void;
  onLevels?: LevelSource;
  menuAt?: (x: number, y: number) => void;
  activity: MascotActivity;
  prowling: boolean;
  away: boolean;
  burst: { kind: "hearts" | "sparkles"; key: number } | null;
  task: FloatingSnapshot["task"];
  dispatch: (input: MascotInput) => void;
  mascot: {
    frame: (at: number) => ReturnType<typeof mascotMotion>;
    fps: () => number;
    onHitTest: (test: ((x: number, y: number) => boolean) | null) => void;
  };
  hitTest: MutableRefObject<((x: number, y: number) => boolean) | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  owlHoverRef: MutableRefObject<boolean>;
  setOwlHover: (on: boolean) => void;
  pet: MutableRefObject<StrokeState>;
  lastClick: MutableRefObject<number | null>;
  drag: MutableRefObject<DragState | null>;
  hovering: MutableRefObject<boolean>;
  controlsHoverRef: MutableRefObject<boolean>;
  controls: { over: boolean; since: number; shown: boolean };
  setControls: Dispatch<SetStateAction<{ over: boolean; since: number; shown: boolean }>>;
  menuOpen: boolean;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  asleep: boolean;
  fxSide: EffectSide;
  captionSide: "left" | "right";
  pillSideNow: PillSide;
  callCard: MascotCallCard;
  setCallCard: (card: MascotCallCard) => void;
  setReplyBusy: (busy: boolean) => void;
  openMenu: (x: number, y: number) => void;
  hover: (on: boolean) => void;
  owlColor: string;
}

export function FloatingBotStage({
  snapshot,
  onEvent,
  mover,
  interactive,
  wantsKeyboard,
  onLevels,
  menuAt,
  activity,
  prowling,
  away,
  burst,
  task,
  dispatch,
  mascot,
  hitTest,
  stageRef,
  owlHoverRef,
  setOwlHover,
  pet,
  lastClick,
  drag,
  hovering,
  controlsHoverRef,
  controls,
  setControls,
  menuOpen,
  setMenuOpen,
  asleep,
  fxSide,
  captionSide,
  pillSideNow,
  callCard,
  setCallCard,
  setReplyBusy,
  openMenu,
  hover,
  owlColor,
}: FloatingBotStageProps) {
  const reduced = snapshot.reduced;
  const call = snapshot.call ?? null;
  const balloon = away ? null : snapshot.balloon;
  const tray = away ? null : snapshot.tray ?? null;
  const balloonOpen = Boolean(balloon);
  const retro = snapshot.retro || snapshot.mascot?.character === "trombi";
  const lane = effectLane(fxSide, OWL_BOX);
  const controlsBlocked = away || menuOpen || Boolean(drag.current?.moved);
  const captionGap = 8 + (captionSide === fxSide ? lane.width + 2 : 0);
  const captionBox = {
    x: captionSide === "right" ? OWL_BOX.left + OWL_BOX.size + captionGap : OWL_BOX.left - captionGap - CAPTIONS_WIDTH,
    y: Math.max(0, OWL_BOX.top - 8),
    width: CAPTIONS_WIDTH,
    height: OWL_SIZE,
  };

  useEffect(() => {
    const next = hoverControlsShown({ over: controls.over, since: controls.since, now: now(), shown: controls.shown, blocked: controlsBlocked });
    if (next.shown !== controls.shown) setControls((current) => ({ ...current, shown: next.shown }));
    if (next.recheckIn === null) return;
    const later = setTimeout(() => setControls((current) => ({ ...current })), next.recheckIn);
    return () => clearTimeout(later);
  }, [controls, controlsBlocked, setControls]);

  // On a call the mascot bounces with its bot's voice (the stage's --fb-voice)
  useEffect(() => {
    const stage = stageRef.current;
    if (!call || !onLevels || !stage) return;
    const off = onLevels((levels) => stage.style.setProperty("--fb-voice", String(levels.bot)));
    return () => {
      off();
      stage.style.removeProperty("--fb-voice");
    };
  }, [Boolean(call), onLevels, stageRef]);

  const overOwl = (event: ReactPointerEvent) => !hitTest.current || hitTest.current(event.clientX, event.clientY);
  const controlsOver = () => {
    const over = owlHoverRef.current || controlsHoverRef.current;
    setControls((current) => (current.over === over ? current : { ...current, over, since: now() }));
  };
  const owlHovered = (on: boolean) => {
    if (!on) pet.current = strokeLeave(pet.current);
    if (owlHoverRef.current === on) return;
    owlHoverRef.current = on;
    setOwlHover(on);
    hover(on);
    controlsOver();
  };
  const controlsHover = (on: boolean) => {
    controlsHoverRef.current = on;
    hover(on);
    controlsOver();
  };
  const stroke = (event: ReactPointerEvent) => {
    if (event.pointerType === "touch") return;
    const at = now();
    const step = strokeStep(pet.current, event.clientX, event.clientY, at);
    pet.current = step.state;
    if (step.pet) {
      dispatch({ type: "pet", now: at });
      onEvent({ type: "pet" });
    }
  };
  const point = (event: ReactPointerEvent) => (mover.coords === "screen" ? { x: event.screenX, y: event.screenY } : { x: event.clientX, y: event.clientY });
  const artCenter = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !overOwl(event)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = { ...point(event), moved: false, id: event.pointerId } as DragState;
    if (event.pointerType === "touch") {
      const at = { x: event.clientX, y: event.clientY };
      start.timer = setTimeout(() => {
        start.menu = true;
        if (menuAt) menuAt(at.x, at.y);
        else setMenuOpen(true);
      }, LONG_PRESS_MS);
    }
    drag.current = start;
    interactive?.(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) {
      const over = overOwl(event);
      owlHovered(over);
      if (over) stroke(event);
      return;
    }
    const here = point(event);
    const dx = here.x - start.x;
    const dy = here.y - start.y;
    if (!start.moved && !isDrag(dx, dy, DRAG_SLOP)) return;
    if (!start.moved) {
      clearTimeout(start.timer);
      dispatch({ type: "drag", now: now(), on: true });
    }
    start.moved = true;
    start.x = here.x;
    start.y = here.y;
    mover.moveBy(dx, dy);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    clearTimeout(start.timer);
    if (start.moved) {
      mover.moved();
      dispatch({ type: "drag", now: now(), on: false });
    } else if (!start.menu) {
      setMenuOpen(false);
      // a plain click on the idle character opens the chat balloon, never a call; on a call it only
      // cuts the bot's voice while it speaks; a second click soon after opens the app
      const gesture = clickGesture(lastClick.current, now());
      lastClick.current = gesture === "double" ? null : now();
      const click = mascotClick({ moved: false, menu: false, onCall: Boolean(snapshot.call), botAudible: Boolean(snapshot.call?.botAudible), gesture });
      if (click === "interrupt") onEvent({ type: "call", action: "interrupt" });
      else if (click === "chat" || click === "open") for (const event of eventsForClick(gesture)) onEvent(event);
    }
    if (!hovering.current) interactive?.(false);
  };

  return (
    <div
      ref={stageRef}
      className="fb-stage"
      data-pose={snapshot.pose}
      data-activity={activity}
      data-asleep={asleep ? "" : undefined}
      data-3d=""
      data-away={away ? "" : undefined}
      data-call={call && !away ? (call.muted || call.phase === "held" ? "quiet" : call.phase) : undefined}
      style={{ "--fb-owl": owlColor, ...(away ? {} : { width: STAGE.width, height: STAGE.height, "--fb-feet": `${STAGE.top + OWL_SIZE - 2}px` }) } as React.CSSProperties}
    >
      {away ? (
        <AwayBadge snapshot={snapshot} hover={hover} onOpen={() => onEvent({ type: "open" })} onMenu={(x, y) => {
          onEvent({ type: "context" });
          openMenu(x, y);
        }} />
      ) : (
        <>
          <StageEffects
            snapshot={snapshot}
            activity={activity}
            burst={burst}
            reduced={reduced}
            asleep={asleep}
            fxSide={fxSide}
            lane={lane}
            controlsShown={controls.shown}
          />
          <MascotHoverControls
            lane={lane}
            side={fxSide}
            shown={controls.shown && !controlsBlocked}
            reduced={reduced}
            chatOpen={balloonOpen}
            trayOpen={Boolean(tray)}
            canCall={Boolean(snapshot.hints.call) || Boolean(call)}
            onCall={Boolean(call)}
            onEvent={onEvent}
            hover={controlsHover}
            name={snapshot.name}
          />
          {call && (
            <MascotCaptions call={call} box={captionBox} side={captionSide} captions={call.captions !== false} />
          )}
          <button
            type="button"
            className="fb-art"
            aria-label={snapshot.label}
            title={snapshot.label}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onPointerEnter={(event) => owlHovered(overOwl(event))}
            onPointerLeave={() => owlHovered(false)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              clearTimeout(drag.current?.timer);
              if (drag.current?.moved) dispatch({ type: "drag", now: now(), on: false });
              drag.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onEvent({ type: "click" });
              } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                const at = artCenter();
                openMenu(at.x, at.y);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onEvent({ type: "context" });
              openMenu(event.clientX, event.clientY);
            }}
          >
            <span className="fb-body" style={{ position: "absolute", left: STAGE.left, top: STAGE.top, width: OWL_SIZE, height: OWL_SIZE }}>
              <Character
                color={snapshot.color}
                skin={snapshot.skin}
                avatarSrc={snapshot.avatar?.src ?? null}
                avatarX={snapshot.avatar?.focusX ?? 0.5}
                avatarY={snapshot.avatar?.focusY ?? 0.5}
                look={snapshot.mascot ? JSON.stringify(snapshot.mascot) : ""}
                pose={snapshot.pose}
                activity={activity}
                prowling={prowling}
                task={task}
                mascot={mascot}
              />
            </span>
          </button>
          {!call && balloon && usesReplyBubble(balloon, retro) && (
            <div className="fb-call fb-reply-call" data-pill-side={pillSideNow} style={{ top: pillTop(pillSideNow, OWL_BOX) }}>
              <ReplyPill balloon={balloon} onEvent={onEvent} hover={hover} wantsKeyboard={wantsKeyboard} callLabel={snapshot.hints.call} onFocusChange={setReplyBusy} />
            </div>
          )}
          {call && (
            <div className="fb-call" data-pill-side={pillSideNow} style={{ top: pillTop(pillSideNow, OWL_BOX) }}>
              <MascotCallPill call={call} name={snapshot.name} card={callCard} onCard={setCallCard} onEvent={onEvent} hover={hover} levels={onLevels} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
