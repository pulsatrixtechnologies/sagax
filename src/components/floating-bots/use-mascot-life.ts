// The floating mascot's own life while FloatingBotView draws it: activity,
// flights, pets, cues, gaze and the frame callback the character renders with.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  mascotFrameRate,
  mascotMotion,
  newMascotState,
  stepMascot,
  type MascotActivity,
  type MascotEffect,
  type MascotInput,
  type MascotState,
} from "./behavior";
import { newStroke, type StrokeState } from "./gestures";
import { cueClipFor } from "./mascots";
import { characterMoves, isMoveClip } from "./moves";
import type { FloatingPilot } from "./pilot";
import type { FloatingSnapshot } from "./protocol";
import type { MascotLook } from "../../../shared/mascot-look";
import { chatFrameRate, mascotTaskFor } from "./view-helpers";

/** How far a flight takes (clips are timed to it). */
const FLIGHT_MS = 1400;
/** The window follows what is drawn a moment later; flights wait for that. */
const RESIZE_SETTLE_MS = 220;
const TICK_MS = 250;
const GAZE_MS = 200;

const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export type DragState = { x: number; y: number; moved: boolean; id: number; timer?: ReturnType<typeof setTimeout>; menu?: boolean };

export interface MascotLife {
  activity: MascotActivity;
  prowling: boolean;
  away: boolean;
  burst: { kind: "hearts" | "sparkles"; key: number } | null;
  dispatch: (input: MascotInput) => void;
  playMove: (clip: string) => void;
  task: FloatingSnapshot["task"];
  chatOpen: boolean;
  call: FloatingSnapshot["call"];
  mascot: {
    frame: (at: number) => ReturnType<typeof mascotMotion>;
    fps: () => number;
    onHitTest: (test: ((x: number, y: number) => boolean) | null) => void;
  };
  hitTest: MutableRefObject<((x: number, y: number) => boolean) | null>;
  stageRef: MutableRefObject<HTMLDivElement | null>;
  owlHoverRef: MutableRefObject<boolean>;
  setOwlHover: (on: boolean) => void;
  pet: MutableRefObject<StrokeState>;
  lastClick: MutableRefObject<number | null>;
  chattingRef: MutableRefObject<boolean>;
}

/**
 * Runs the mascot state machine for one FloatingBotView: task, cues, ticks,
 * gaze, and the effects that move its window.
 */
export function useMascotLife({
  snapshot,
  pilot,
  onMove,
  drag,
}: {
  snapshot: FloatingSnapshot;
  pilot: FloatingPilot | null;
  onMove?: (listener: (clip: string) => void) => () => void;
  drag: MutableRefObject<DragState | null>;
}): MascotLife {
  const reduced = snapshot.reduced;
  const stageRef = useRef<HTMLDivElement>(null);
  const mascotRef = useRef<MascotState>(newMascotState(now()));
  const [activity, setActivity] = useState<MascotActivity>("idle");
  const [prowling, setProwling] = useState(false);
  const [away, setAway] = useState(false);
  const [, setOwlHover] = useState(false);
  const owlHoverRef = useRef(false);
  const [burst, setBurst] = useState<{ kind: "hearts" | "sparkles"; key: number } | null>(null);
  const hitTest = useRef<((x: number, y: number) => boolean) | null>(null);
  const gaze = useRef<{ x: number; y: number } | null>(null);
  const pet = useRef(newStroke());
  const lastClick = useRef<number | null>(null);
  const call = snapshot.call ?? null;
  const chatOpen = Boolean(snapshot.balloon) || Boolean(call);
  const task = mascotTaskFor(snapshot.task, chatOpen);
  const dog = snapshot.mascot?.character === "shiba";
  const cat = snapshot.mascot?.character === "grump";
  const frog = snapshot.mascot?.character === "frog";
  const mascotOptions = () => ({
    reduced,
    flyAway: snapshot.flyAway,
    canMove: Boolean(pilot) && !chatOpen && !((dog || cat || frog) && task === "waiting"),
    dog,
    cat,
    frog,
    random: Math.random,
    liveliness: snapshot.liveliness ?? "normal",
    mood: snapshot.mood,
    depth: false,
  });
  const options = useRef(mascotOptions());
  options.current = mascotOptions();
  const moodRef = useRef(snapshot.mood);
  moodRef.current = snapshot.mood;
  const poseRef = useRef(snapshot.pose);
  poseRef.current = snapshot.pose;
  const pilotRef = useRef(pilot);
  pilotRef.current = pilot;

  const dispatchRef = useRef<(input: MascotInput) => void>(() => undefined);
  const runEffect = useCallback((effect: MascotEffect) => {
    const flight = pilotRef.current;
    const arrived = () => dispatchRef.current({ type: "arrived", now: now() });
    switch (effect.type) {
      case "flyOut":
        // the owl crouches and spreads its wings first; the window leaves with the jump
        if (flight) setTimeout(() => void flight.flyOut(FLIGHT_MS).finally(arrived), effect.delay);
        else setTimeout(arrived, effect.delay + FLIGHT_MS);
        break;
      case "flyHome":
        // let the window grow back to the owl first, then fly it home
        if (flight) setTimeout(() => void flight.flyHome(FLIGHT_MS).finally(arrived), RESIZE_SETTLE_MS);
        else setTimeout(arrived, FLIGHT_MS);
        break;
      case "wander":
        if (flight) setTimeout(() => void flight.wander(effect.dx, effect.ms, effect.style).finally(arrived), effect.delay);
        else arrived();
        break;
      case "halt":
        flight?.halt();
        break;
      case "hearts":
      case "sparkles":
        setBurst({ kind: effect.type, key: now() });
        break;
      default:
        break;
    }
  }, []);
  const dispatch = useCallback((input: MascotInput) => {
    const { state, effects } = stepMascot(mascotRef.current, input, options.current);
    mascotRef.current = state;
    setActivity(state.activity);
    setProwling(state.activity === "walk" && state.trip?.phase === "stalk");
    // the badge shows once parked (working), and the owl again as soon as it heads home
    setAway(state.away && state.activity === "working");
    for (const effect of effects) runEffect(effect);
  }, [runEffect]);
  dispatchRef.current = dispatch;

  // a move picked by name ("Moves"): only one this character has
  const lookKey = snapshot.mascot ? JSON.stringify(snapshot.mascot) : "";
  const playMove = useCallback((clip: string) => {
    const move = characterMoves(lookKey ? (JSON.parse(lookKey) as MascotLook) : undefined).find((candidate) => candidate.clip === clip);
    if (move && isMoveClip(move.clip)) dispatchRef.current({ type: "move", now: now(), clip: move.clip });
  }, [lookKey]);
  useEffect(() => onMove?.(playMove), [onMove, playMove]);

  // what just happened to the person, and a reply that lands: the character's own reaction, if it has one
  const character = snapshot.mascot?.character ?? "owl";
  const cueAt = snapshot.cue?.at ?? 0;
  const cueKind = snapshot.cue?.kind ?? null;
  const seenCue = useRef(cueAt);
  useEffect(() => {
    if (!cueAt || cueAt === seenCue.current || !cueKind) return;
    seenCue.current = cueAt;
    const clip = cueClipFor(character, cueKind);
    if (clip) dispatchRef.current({ type: "move", now: now(), clip });
  }, [cueAt, cueKind, character]);
  // its bot hit an error: the character's own reaction (a Grump flattens its ears)
  const seenTask = useRef(task);
  useEffect(() => {
    if (task === seenTask.current) return;
    seenTask.current = task;
    const clip = task === "error" ? cueClipFor(character, "error") : null;
    if (clip) dispatchRef.current({ type: "move", now: now(), clip });
  }, [task, character]);
  const seenSparkle = useRef(snapshot.sparkle);
  useEffect(() => {
    if (snapshot.sparkle === seenSparkle.current) return;
    seenSparkle.current = snapshot.sparkle;
    const clip = cueClipFor(character, "message");
    if (clip) dispatchRef.current({ type: "move", now: now(), clip });
  }, [snapshot.sparkle, character]);

  // the bot's work, from the brain: fly off, come back
  useEffect(() => {
    dispatch({ type: "task", now: now(), task });
  }, [dispatch, task]);

  // a walk under way stops where it is when the balloon opens
  useEffect(() => {
    if (chatOpen) pilotRef.current?.halt();
  }, [chatOpen]);

  // the mascot's clock: idle actions, naps, timed reactions ending
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      dispatch({ type: "tick", now: now() });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [dispatch]);

  // once parked at the edge and shrunk to the badge, snap to the edge
  useEffect(() => {
    if (!away) return;
    const later = setTimeout(() => void pilotRef.current?.park(), RESIZE_SETTLE_MS);
    return () => clearTimeout(later);
  }, [away]);

  useEffect(() => {
    if (!burst) return;
    const done = setTimeout(() => setBurst(null), 1400);
    return () => clearTimeout(done);
  }, [burst]);

  // the head follows the pointer: on the desktop it is asked of main (the
  // pointer is mostly outside this small window); over the app it is the page's own
  useEffect(() => {
    if (reduced) {
      gaze.current = null;
      return;
    }
    // the pointer: where the eyes look, and how near and fast it is (startle, greeting)
    let previous: { x: number; y: number; at: number } | null = null;
    const notice = (offset: { x: number; y: number } | null) => {
      const at = now();
      gaze.current = offset ? { x: clamp(offset.x / 420, -1, 1), y: clamp(offset.y / 320, -1, 1) } : null;
      const speed = offset && previous ? Math.hypot(offset.x - previous.x, offset.y - previous.y) / Math.max(0.016, (at - previous.at) / 1000) : 0;
      previous = offset ? { ...offset, at } : null;
      dispatchRef.current({ type: "cursor", now: at, distance: offset ? Math.hypot(offset.x, offset.y) : null, speed });
    };
    if (pilot) {
      let alive = true;
      const timer = setInterval(() => {
        if (document.hidden || mascotRef.current.away || mascotRef.current.activity === "sleep") return;
        void pilot.sense().then(({ cursor, room }) => {
          if (!alive) return;
          notice(cursor);
          if (room) dispatchRef.current({ type: "room", now: now(), left: room.left, right: room.right });
        });
      }, GAZE_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }
    let lastNotice = 0;
    const onPointer = (event: PointerEvent) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || now() - lastNotice < GAZE_MS / 2) return;
      lastNotice = now();
      notice({ x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height * 0.4) });
    };
    window.addEventListener("pointermove", onPointer);
    return () => window.removeEventListener("pointermove", onPointer);
  }, [pilot, reduced]);

  // While the balloon is open the mascot lives at half rate: the eye is on the chat, and every
  // frame it draws repaints the whole (larger) transparent window
  const chattingRef = useRef(false);
  const mascot = useRef({
    frame: (at: number) => mascotMotion(mascotRef.current, { now: at, pose: poseRef.current, reduced: options.current.reduced, gaze: gaze.current, mood: moodRef.current }),
    fps: () => chatFrameRate(mascotFrameRate(mascotRef.current.activity, owlHoverRef.current, options.current.reduced), chattingRef.current && !drag.current?.moved),
    onHitTest: (test: ((x: number, y: number) => boolean) | null) => {
      hitTest.current = test;
    },
  }).current;

  return {
    activity,
    prowling,
    away,
    burst,
    dispatch,
    playMove,
    task,
    chatOpen,
    call,
    mascot,
    hitTest,
    stageRef,
    owlHoverRef,
    setOwlHover,
    pet,
    lastClick,
    chattingRef,
  };
}
