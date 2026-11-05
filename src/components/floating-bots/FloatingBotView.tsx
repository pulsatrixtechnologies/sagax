// What a floating bot looks like: its mascot (the flat owl in the bot's colour,
// or its picture) standing on the desktop or over the app, with a little life
// of its own (behavior.ts: it breathes, blinks, looks at the pointer, spins,
// hops, wanders, naps, reacts to clicks and strokes, flies off while its bot
// works), a speech balloon with a small input, and a right-click menu. It
// only draws a snapshot and reports what was clicked or typed; the brain
// (FloatingBots.tsx) decides everything else. The same view runs in a
// desktop window (FloatingBotWindow.tsx) and in the in-app overlay.
import "./floating-bots.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { botBubbleVars } from "@/lib/bubble-colors";
import { cn } from "@/lib/cn";
import { MAUS_COLORS } from "@/lib/mascot";
import { Balloon, BALLOON_MAX_W, readBalloonPlace, splitOffset, type BalloonSide } from "./Balloon";
import { useHeldMenuMotion } from "@/components/MenuMotion";
import { ReplyBubble, usesReplyBubble } from "./ReplyBubble";
import { MascotCallCardView, type MascotCallCard } from "./MascotCall";
import { MascotTray } from "./MascotControls";
import { mascotFields, type FloatingSnapshot } from "./protocol";
import { dockedWindowSize } from "./window-frame";
import { effectSide, pillTop, type EffectSide, type PillSide } from "./placement";
import { mascotAsleep } from "./sleep";
import { FloatingBotStage } from "./FloatingBotStage";
import { useMascotLife, type DragState } from "./use-mascot-life";
import { MASCOT_SIZE, MASCOT_STAGE, OWL_BOX, OWL_SIZE, STAGE } from "./stage-size";
import {
  balloonSide,
  chatFrameRate,
  chatRoomFor,
  drawnMenuRows,
  emoteFor,
  mascotTaskFor,
  owlStateFor,
  owlStateForPose,
} from "./view-helpers";
import type { FloatingBotViewProps, FloatingMover, MascotLayout } from "./floating-view-types";

export type { FloatingBotViewProps, FloatingMover, MascotLayout };
export { MASCOT_SIZE, MASCOT_STAGE, OWL_BOX, OWL_SIZE, STAGE };
export { owlStateFor, owlStateForPose, chatRoomFor, drawnMenuRows, balloonSide, mascotTaskFor, chatFrameRate, emoteFor };

/** The call card's gap to the character's head, px. */
const CARD_GAP = 6;

/** A bot colour name or hex, as CSS (the parked badge wears it). */
const owlHex = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{3,8}$/.test(color) ? color : MAUS_COLORS.green);

export function FloatingBotView({ snapshot: given, onEvent, mover, interactive, wantsKeyboard, rootRef, className, style, below, pilot = null, onSide, onReserve, onLevels, menuAt, onMove, layout = null }: FloatingBotViewProps) {
  // an older brain may not send the mascot's fields yet
  const snapshot: FloatingSnapshot = given.hints ? given : { ...given, ...mascotFields(given) };
  const [menuOpen, setMenuOpen] = useState(false);
  const drag = useRef<DragState | null>(null);
  const hovering = useRef(false);
  const controlsHoverRef = useRef(false);
  const [controls, setControls] = useState({ over: false, since: 0, shown: false });
  // Trombi talks in the Hibou 98 look, whatever the skin
  const retro = snapshot.retro || snapshot.mascot?.character === "trombi";

  const life = useMascotLife({ snapshot, pilot, onMove, drag });
  const { activity, prowling, away, burst, dispatch, playMove, task, call, mascot, hitTest, stageRef, owlHoverRef, setOwlHover, pet, lastClick, chattingRef } = life;

  /** A choice in the menu: a move plays here; anything else is the brain's. */
  const chooseMenu = (id: string) => {
    setMenuOpen(false);
    if (id.startsWith("move:")) playMove(id.slice(5));
    else onEvent({ type: "menu", id });
  };

  const balloon = away ? null : snapshot.balloon;
  // the balloon plays its close before it goes (the open pop backwards; at once under reduced motion)
  const shown = useHeldMenuMotion(balloon);
  // Which way the balloon opens, decided when it opens and kept while it is open, so the
  // mascot never jumps: above unless the screen's top is too near, to the left unless its edge is
  const [ownSide, setSide] = useState<BalloonSide>({ below: Boolean(below), right: false });
  const [ownRoom, setRoom] = useState({ x: 0, y: 0, w: BALLOON_MAX_W, h: 420 });
  // on the desktop the window's layout decides (FloatingBotWindow, from where the character stands)
  const desk = pilot && layout ? layout : null;
  const side = desk ? desk.side : ownSide;
  const room = desk?.chat ? chatRoomFor(desk.chat) : ownRoom;
  const shift = desk?.chat?.shift ?? 0;
  const balloonOpen = Boolean(balloon);
  const asleep = !away && mascotAsleep(activity, snapshot.pose);
  // the pill under the feet, or over the head near the Dock: the card above then sits over the pill
  const pillSideNow: PillSide = desk?.pill ?? "below";
  const pillShown = Boolean(call) || Boolean(balloon && usesReplyBubble(balloon, retro));
  const pillAbove = pillSideNow === "above" && pillShown;
  const cardOverlap = pillAbove ? pillTop("above", OWL_BOX) - CARD_GAP + 2 : STAGE.top - CARD_GAP + 8;
  // the call pill's card (settings, transcript) opens where the balloon goes
  const [callCard, setCallCard] = useState<MascotCallCard>(null);
  // a draft in the reply pill keeps the reply's bubble from fading
  const [replyBusy, setReplyBusy] = useState(false);
  useEffect(() => {
    if (!call) setCallCard(null);
  }, [call]);
  const callCardShown = Boolean(call && (callCard || call.note || call.notice));
  // the activity tray (the hover controls' bell) opens where the chat goes
  const tray = away ? null : snapshot.tray ?? null;
  const panelOpen = balloonOpen || callCardShown || Boolean(tray);
  chattingRef.current = balloonOpen || Boolean(call);
  useLayoutEffect(() => {
    if (!panelOpen || desk) return;
    const next = balloonSide(pilot ? "desktop" : "overlay", Boolean(below), STAGE.height);
    setSide(next.side);
    setRoom(next.room);
    onSide?.(next.side);
    // decided once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // While the mascot is home the desktop window already holds the quick chat,
  // so a click paints the balloon and does not move the character. Away, the
  // window fits the badge. The open balloon reports its own room.
  useLayoutEffect(() => {
    if (!onReserve || !pilot || panelOpen) return;
    if (away) {
      onReserve(null, true);
      return;
    }
    const saved = readBalloonPlace(snapshot.id ?? snapshot.name);
    const held = splitOffset(saved, side).away;
    onReserve(dockedWindowSize(STAGE, { w: saved.w, h: saved.h, dx: held.dx + shift, dy: held.dy }), false);
  }, [onReserve, pilot, panelOpen, away, snapshot.id, snapshot.name, side.below, side.right, shift]);

  // The effects (signs, hearts, the thought dots, the Zzz) go beside the character, never over
  // it: on the desktop the window's layout says which side; over the app, the viewport's room
  const [ownFx, setOwnFx] = useState<EffectSide>("right");
  const fxShown = activity !== "idle" || Boolean(burst) || snapshot.pose === "think" || asleep;
  useLayoutEffect(() => {
    if (desk || !fxShown || typeof window === "undefined") return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = effectSide({
      body: { x: rect.left + OWL_BOX.left, y: rect.top + OWL_BOX.top, width: OWL_BOX.size, height: OWL_BOX.size },
      workArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      chatSide: balloon ? side : null,
    });
    setOwnFx((current) => (current === next ? current : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk, fxShown, activity, burst]);
  const fxSide: EffectSide = desk?.fx ?? ownFx;
  // the captions beside the character during a call: on the side the window holds room on
  // (the chat's, empty during a call), past the controls' lane when that is the same side
  const captionSide: "left" | "right" = desk ? (desk.side.right ? "right" : "left") : fxSide === "left" ? "left" : "right";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else if (callCard) setCallCard(null);
      else if (tray) onEvent({ type: "tray", open: false });
      else if (balloon) onEvent({ type: "dismiss" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, callCard, tray, balloon, onEvent]);

  // With no balloon to type in, give the keyboard back to whatever had it (the balloon takes it when it opens).
  const hasInput = Boolean(balloon?.input);
  useEffect(() => {
    if (!hasInput) wantsKeyboard?.(false);
  }, [hasInput, wantsKeyboard]);

  /** The menu at the pointer: main's native one on the desktop, the drawn one in the app. */
  const openMenu = (x: number, y: number) => {
    if (menuAt) {
      setMenuOpen(false);
      menuAt(x, y);
    } else setMenuOpen((open) => !open);
  };
  const hover = (on: boolean) => {
    hovering.current = on;
    if (!drag.current) interactive?.(on);
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "fb-root",
        retro && "r98-root",
        // the desktop window keeps its corner whether the chat is open or not (it holds the chat's room there)
        (desk ? side.below : balloon ? side.below : below) && "fb-below",
        (desk ? side.right : balloon && side.right) && "fb-left",
        className,
      )}
      // the question I asked (.fb-asked) in this bot's colour (bubble-colors.ts, botBubbleVars)
      style={{ ...style, ...botBubbleVars(owlHex(snapshot.color)), ...((desk ? side.right : balloon && side.right) ? { alignItems: "flex-start" } : {}), "--fb-tail": `${Math.round(STAGE.width / 2) - 7}px`, "--fb-stage-h": `${STAGE.height}px` } as React.CSSProperties}
      data-reduced={snapshot.reduced ? "" : undefined}
      data-retro={retro ? "" : undefined}
      data-chatting={balloon ? "" : undefined}
      lang={snapshot.locale}
    >
      {shown.shown && shown.value && usesReplyBubble(shown.value, retro) && (
        // the reply as voice mode draws it: a speech bubble over the head that fades by itself
        <ReplyBubble
          name={snapshot.name}
          balloon={shown.value}
          closing={shown.closing}
          below={side.below}
          stage={STAGE}
          onReserve={shown.closing ? undefined : onReserve}
          onEvent={onEvent}
          hover={hover}
          held={replyBusy}
          // right above the character's head, over the stage's empty room (as the call's card)
          style={side.below ? undefined : { marginBottom: -cardOverlap }}
        />
      )}
      {shown.shown && shown.value && !usesReplyBubble(shown.value, retro) && (
        <Balloon
          botId={snapshot.id ?? snapshot.name}
          name={snapshot.name}
          balloon={shown.value}
          closing={shown.closing}
          retro={retro}
          side={side}
          room={room}
          shift={shift}
          stage={STAGE}
          owl={OWL_BOX}
          onReserve={shown.closing ? undefined : onReserve}
          onEvent={onEvent}
          hover={hover}
          wantsKeyboard={wantsKeyboard}
          pinLabel={snapshot.hints.pin ?? ""}
          callLabel={!call ? snapshot.hints.call : undefined}
        />
      )}
      {call && callCardShown && (
        // right above the character's head, over the stage's empty room (no gap of empty stage between them)
        <MascotCallCardView call={call} name={snapshot.name} card={callCard} onEvent={onEvent} hover={hover} style={side.below ? undefined : { marginBottom: -cardOverlap }} />
      )}
      {tray && !balloon && (
        // where the chat goes, right above the character's head (as the call's card)
        <MascotTray tray={tray} name={snapshot.name} onEvent={onEvent} hover={hover} style={side.below ? undefined : { marginBottom: -cardOverlap }} />
      )}
      {menuOpen && (
        <div role="menu" aria-label={snapshot.name} className={cn("fb-menu", retro && "r98-menu")} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
          {drawnMenuRows(snapshot.menu).map(({ item, depth }) =>
            item.type === "separator" ? (
              <span key={item.id} role="separator" className="fb-menu-sep" />
            ) : item.items ? (
              <span key={item.id} role="presentation" className="fb-menu-group">{item.label}</span>
            ) : (
              <button
                key={item.id}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                disabled={item.enabled === false}
                data-depth={depth || undefined}
                className={cn("fb-menu-item", retro && "r98-menu-item")}
                onClick={() => chooseMenu(item.id)}
              >
                <span className="fb-check" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
      <FloatingBotStage
        snapshot={snapshot}
        onEvent={onEvent}
        mover={mover}
        interactive={interactive}
        wantsKeyboard={wantsKeyboard}
        onLevels={onLevels}
        menuAt={menuAt}
        activity={activity}
        prowling={prowling}
        away={away}
        burst={burst}
        task={task}
        dispatch={dispatch}
        mascot={mascot}
        hitTest={hitTest}
        stageRef={stageRef}
        owlHoverRef={owlHoverRef}
        setOwlHover={setOwlHover}
        pet={pet}
        lastClick={lastClick}
        drag={drag}
        hovering={hovering}
        controlsHoverRef={controlsHoverRef}
        controls={controls}
        setControls={setControls}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        asleep={asleep}
        fxSide={fxSide}
        captionSide={captionSide}
        pillSideNow={pillSideNow}
        callCard={callCard}
        setCallCard={setCallCard}
        setReplyBusy={setReplyBusy}
        openMenu={openMenu}
        hover={hover}
        owlColor={owlHex(snapshot.color)}
      />
    </div>
  );
}
