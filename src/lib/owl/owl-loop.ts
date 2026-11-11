// One clock for every animated owl on the page. Each OwlAvatar registers a
// controller that writes CSS transforms straight onto its SVG groups (via
// refs): no React state changes per frame. Static owls (animated=false)
// never register, so a resting sidebar costs nothing.
//
// Working, a wing move, a blink, and the shake of an unread face run on
// requestAnimationFrame. A resting pose (a breath, or an unread face that
// has finished its shake) waits on a short timer instead, so a sidebar of
// unread owls does not repaint the glass bars at the display rate.
//
// Nothing runs for an owl that has nothing to draw (#3624): a sidebar owl
// that only follows the pointer sleeps once its eyes have settled, until
// the pointer moves; an owl scrolled out of view (an IntersectionObserver)
// is not ticked; a hidden window runs nothing. The blink of an owl at rest
// is one Web Animation on its lids, started after a delay: the browser waits
// on a timer, so a quiet window asks for no frame and runs no script between
// two blinks, and only one call per blink arms the next.

import { animationsPaused, resetAnimationPauseForTests, watchAnimationPause } from "../animation-pause";
import {
  OWL_BREATH_PERIOD_S,
  OWL_WORKING_PERIOD_S,
  OWL_GEOM,
  eyesTransform,
  farWingOpacity,
  farWingTransform,
  owlWingPose,
  gazeToOffset,
  lidTransform,
  owlPose,
  pupilTransform,
  rigTransform,
  wingTransform,
  type OwlState,
  type OwlWingMove,
} from "./owl-art";

export interface OwlRigElements {
  rig: SVGGElement;
  nearWing: SVGGElement;
  eyes: SVGGElement;
  pupil: SVGGElement;
  lids: SVGGElement;
  /** The far wing, behind the body; hidden while the wings are folded. */
  farWing?: SVGGElement | null;
  /** Layers behind the body that follow the near wing (its rim). */
  nearWingBack?: SVGGElement | null;
}

type Offset = { x: number; y: number };

export interface OwlController {
  /** The continuous state the owl returns to (idle/thinking/working/sleepy). */
  setState(state: OwlState): void;
  /**
   * Play a state for a moment. success and alert run once (their own length);
   * the others hold for `durationMs`. Then the continuous state resumes.
   */
  play(state: OwlState, durationMs?: number): void;
  blink(): void;
  /** Open the wings for one move (spread, flap, take off...). Ignored under reduced motion. */
  flourish(move: OwlWingMove): void;
  /** Pointer-driven pupil offset (viewBox units), or null when the pointer left. */
  setPointer(offset: Offset | null): void;
  /** A caller-pinned pupil offset (viewBox units), or null for the state's own. */
  setPinnedGaze(offset: Offset | null): void;
  setHop(hop: number): void;
  /** Force reduced motion on/off; undefined follows the OS setting. */
  setReducedMotion(value: boolean | undefined): void;
  destroy(): void;
}

interface Driven {
  tick(now: number): void;
  /** The last tick needed a display-rate frame (motion that would alias at 12Hz). */
  fullRate: boolean;
  /** When a resting owl next has something to draw (s, on the frame clock):
   * 0 at the resting pace, Infinity when only an input wakes it. */
  wakeAt: number;
  /** Scrolled out of view: not ticked until it comes back. */
  offscreen: boolean;
  /** The element whose visibility decides (the owl's svg). */
  el: Element | null;
  /** Came on screen (and the window shows), or left it. */
  onShown?(shown: boolean): void;
}

/** Resting poses do not need a display-rate clock. The gap leaves room for
 * one vsync, so the next paint lands near 12Hz. */
const REST_FRAME_GAP_MS = 70;

const running = new Set<Driven>();
let rafId = 0;
let slowTimer: ReturnType<typeof setTimeout> | 0 = 0;
let reduceMQ: MediaQueryList | null = null;
let pauseUnsub: (() => void) | null = null;
let observer: IntersectionObserver | null = null;

const clockNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function onScreen(c: Driven): boolean {
  return !c.offscreen;
}

function ensureObserver() {
  if (observer || typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver((records) => {
    let shown = false;
    for (const record of records) {
      for (const c of running) {
        if (c.el !== record.target) continue;
        c.offscreen = !record.isIntersecting;
        c.onShown?.(record.isIntersecting && !animationsPaused());
        // a breath in CSS holds still off screen too
        if (record.isIntersecting) record.target.removeAttribute("data-owl-offscreen");
        else record.target.setAttribute("data-owl-offscreen", "");
        if (record.isIntersecting) shown = true;
      }
    }
    if (shown) kick();
  });
}

function clearSlow() {
  if (!slowTimer) return;
  clearTimeout(slowTimer);
  slowTimer = 0;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  reduceMQ ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return reduceMQ.matches;
}

function frame(now: number) {
  // A hidden or minimized window must not keep the frame clock.
  if (animationsPaused()) {
    rafId = 0;
    return;
  }
  for (const c of running) if (onScreen(c)) c.tick(now / 1000);
  rafId = 0;
  if (!running.size) return;
  let full = false;
  for (const c of running) if (c.fullRate && onScreen(c)) full = true;
  if (full) kick();
  else scheduleSlow();
}

/** The soonest a resting owl on screen has something to draw (s), or Infinity. */
function nextWake(): number {
  let soonest = Infinity;
  for (const c of running) if (onScreen(c)) soonest = Math.min(soonest, c.wakeAt);
  return soonest;
}

function scheduleSlow() {
  if (animationsPaused() || rafId || slowTimer || !running.size) return;
  const wake = nextWake();
  if (!Number.isFinite(wake)) return;
  slowTimer = setTimeout(() => {
    slowTimer = 0;
    kick();
  }, Math.max(REST_FRAME_GAP_MS, wake * 1000 - clockNow()));
}

/** Something changed (a state, the pointer, a blink): draw on the next frame. */
function kick() {
  if (animationsPaused() || rafId || !running.size) return;
  clearSlow();
  if (typeof requestAnimationFrame !== "function") return;
  rafId = requestAnimationFrame(frame);
}

function ensurePauseWatch() {
  if (pauseUnsub || typeof document === "undefined") return;
  pauseUnsub = watchAnimationPause(() => {
    if (animationsPaused()) {
      if (rafId && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      clearSlow();
      // the blinks hold too
      for (const c of running) c.onShown?.(false);
      return;
    }
    for (const c of running) if (!c.offscreen) c.onShown?.(true);
    kick();
  });
}

function start(c: Driven) {
  if (!running.has(c)) {
    running.add(c);
    ensureObserver();
    if (c.el) observer?.observe(c.el);
  }
  ensurePauseWatch();
  kick();
}

function stop(c: Driven) {
  if (running.delete(c) && c.el) {
    observer?.unobserve(c.el);
    c.el.removeAttribute("data-owl-offscreen");
  }
  if (running.size) return;
  if (rafId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  clearSlow();
}

/** Drops the pause subscription. Tests call this between cases. */
export function resetOwlLoopForTests(): void {
  pauseUnsub?.();
  pauseUnsub = null;
  observer?.disconnect();
  observer = null;
  resetAnimationPauseForTests();
  reduceMQ = null;
  clearSlow();
  if (rafId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

/** How many owls the shared loop is driving (for tests and diagnostics). */
export function runningOwlCount(): number {
  return running.size;
}

const ONE_SHOTS = new Set<OwlState>(["success", "alert"]);
/** An awake blink: its length (s), and the lids' close and open sampled
 * along the same half sine the script draws (lidTransform). */
const BLINK_S = 0.16;
const BLINK_STEPS = 16;
let blinkKeyframes: Keyframe[] | null = null;
function blinkFrames(): Keyframe[] {
  blinkKeyframes ??= Array.from({ length: BLINK_STEPS + 1 }, (_, i) => ({
    offset: i / BLINK_STEPS,
    transform: lidTransform(i === BLINK_STEPS ? 0 : Math.sin((Math.PI * i) / BLINK_STEPS)),
  }));
  return blinkKeyframes;
}
/** The ground pivot of the breath, in the svg's box (viewBox 0 0 256 256). */
const BREATH_ORIGIN = `${(OWL_GEOM.pivots.ground.x / 256) * 100}% ${(OWL_GEOM.pivots.ground.y / 256) * 100}%`;
/** The steady motions styles.css draws for a pose (`owl-breathe`, and
 * `owl-working-bounce` with `owl-working-wing`), with the length of a cycle. */
type CssMotion = "breath" | "working";
const CSS_MOTION_PERIOD_S: Record<CssMotion, number> = { breath: OWL_BREATH_PERIOD_S, working: OWL_WORKING_PERIOD_S };

export function createOwlController(
  el: OwlRigElements,
  opts: { state?: OwlState; hop?: number; pinnedGaze?: Offset | null; reducedMotion?: boolean; gazeOnly?: boolean } = {},
): OwlController {
  let base: OwlState = opts.state ?? "idle";
  let hop = opts.hop ?? 1;
  let forcedReduce = opts.reducedMotion;
  const gazeOnly = opts.gazeOnly === true;
  let pinned: Offset | null = opts.pinnedGaze ?? null;
  let pointer: Offset | null = null;

  // the transient beat, if any: a one-shot or a held state with a deadline
  let beat: { state: OwlState; untilMs: number | null } | null = null;
  let beatPending = false;
  let t0: number | null = null;
  let last: number | null = null;
  let nextBlink = 0;
  let blinkStart = -1;
  let blinkPending = false;
  let wingMove: { move: OwlWingMove; start: number | null } | null = null;
  let farShown = false;
  const gaze: Offset = { ...OWL_GEOM.gazeRest };
  /** The transform last written on each group (writeTransform). */
  const written = new Map<CSSStyleDeclaration, string>();
  // The steady motions run in CSS (#3624), from the same numbers as the
  // pose: the resting breath (about the same ground point) and the working
  // bounce on the owl's svg, on the compositor; the working wing flap on its
  // two groups. A resting or working owl then runs no script per frame, only
  // its blinks. The delay starts the CSS cycle where the pose's own clock
  // is, so taking a motion over (or handing it back) never jumps.
  const svgRoot = (el.rig.ownerSVGElement ?? null) as SVGSVGElement | null;
  let cssMotion: CssMotion | null = null;
  const setCssMotion = (motion: CssMotion | null, elapsed: number) => {
    if (!svgRoot || motion === cssMotion) return;
    cssMotion = motion;
    if (motion) {
      svgRoot.style.transformOrigin = BREATH_ORIGIN;
      svgRoot.style.setProperty("--owl-motion-delay", `${-(elapsed % CSS_MOTION_PERIOD_S[motion]).toFixed(3)}s`);
      svgRoot.setAttribute("data-owl-motion", motion);
    } else svgRoot.removeAttribute("data-owl-motion");
  };

  // The blink of an owl at rest (#3624): one Web Animation on the lids,
  // delayed to the blink's time, so the browser waits on a timer and the
  // loop sleeps; when it ends, the next one is armed 3 to 6 s later, as the
  // script would draw it. An owl the script draws (a beat, a wing move,
  // sleepy lids) blinks by script instead.
  const lidsAnimate = typeof (el.lids as Partial<Element>).animate === "function";
  let cssBlink: Animation | null = null;
  const cancelCssBlink = () => {
    const anim = cssBlink;
    if (!anim) return;
    cssBlink = null;
    anim.onfinish = null;
    anim.cancel();
  };
  const armCssBlink = () => {
    if (cssBlink) return;
    const delay = Math.max(0, nextBlink * 1000 - clockNow());
    const anim = el.lids.animate(blinkFrames(), { duration: BLINK_S * 1000, delay, id: "owl-blink" });
    cssBlink = anim;
    // a canceled blink rejects its promise: nothing waits on it
    anim.finished?.catch(() => {});
    if (driven.offscreen || animationsPaused()) anim.pause();
    anim.onfinish = () => {
      if (cssBlink !== anim) return;
      cssBlink = null;
      nextBlink = clockNow() / 1000 + 3 + Math.random() * 3;
      armCssBlink();
    };
  };

  const driven: Driven = {
    fullRate: false,
    wakeAt: 0,
    offscreen: false,
    el: el.rig.ownerSVGElement ?? null,
    onShown(shown) {
      // a blink waits (or holds) while its owl is scrolled away or the
      // window is hidden
      if (!cssBlink) return;
      if (shown) cssBlink.play();
      else cssBlink.pause();
    },
    tick(now) {
      if (t0 === null || beatPending) {
        t0 = now;
        beatPending = false;
      }
      if (!nextBlink) nextBlink = now + 1 + Math.random() * 4;
      if (blinkPending) {
        blinkStart = now;
        blinkPending = false;
      }
      const dt = last === null ? 0 : Math.min(0.1, now - last);
      last = now;

      if (beat?.untilMs != null && (now - t0) * 1000 >= beat.untilMs) {
        beat = null;
        t0 = now;
      }
      const state = beat?.state ?? base;
      const oneShot = beat != null && ONE_SHOTS.has(beat.state);
      const elapsed = now - t0;
      // Unread faces shake for the first part of the alert cycle, then hold.
      // Only the shake needs a display-rate clock.
      const alertPhase = state === "alert" ? (oneShot ? elapsed : elapsed % 1.8) : 1;
      const pose = owlPose(state, elapsed, !oneShot, hop);
      let paintAgain = false;
      if (pose.done) {
        beat = null;
        t0 = now;
        paintAgain = true;
      }
      if (wingMove) {
        wingMove.start ??= now;
        const w = owlWingPose(wingMove.move, now - wingMove.start, hop);
        if (w.done) wingMove = null;
        else {
          pose.open = Math.max(pose.open, w.open);
          pose.wing += w.flap;
          pose.x += w.x;
          pose.y += w.y;
          pose.sy *= w.sy;
        }
      }

      const reduce = (forcedReduce ?? prefersReducedMotion()) && !gazeOnly;
      // a steady pose moves in CSS, not here: the breath at rest, the bounce
      // and the wing flap while working (a beat or a wing move is drawn here)
      const motion: CssMotion | null = gazeOnly || reduce || wingMove !== null || svgRoot === null ? null
        : state === "idle" ? "breath" : state === "working" && !beat ? "working" : null;
      // the lids are the blink's alone: it runs as an animation, not here
      const blinkInCss = lidsAnimate && (gazeOnly || (motion !== null && pose.lid === 0));
      if (blinkInCss) armCssBlink();
      else cancelCssBlink();

      // Blink every 3-6 s (slower when sleepy). Kept under reduced motion.
      if (!blinkInCss && now >= nextBlink) {
        blinkStart = now;
        nextBlink = now + (state === "sleepy" ? 4 + Math.random() * 3 : 3 + Math.random() * 3);
      }
      const blinkDur = state === "sleepy" ? 0.45 : 0.16;
      const blinkAmt =
        blinkStart >= 0 && now - blinkStart < blinkDur ? Math.sin((Math.PI * (now - blinkStart)) / blinkDur) : 0;
      const lid = Math.max(pose.lid, blinkAmt);

      let wrote = false;
      // compared with what this owl last wrote, never read back: the
      // browser hands a transform back in its own spelling ("0px, 0.5px"),
      // so a read-back never matched and every tick rewrote every group
      const writeTransform = (style: CSSStyleDeclaration, value: string) => {
        if (written.get(style) === value) return;
        written.set(style, value);
        style.transform = value;
        wrote = true;
      };
      driven.wakeAt = 0;
      setCssMotion(motion, elapsed);
      if (motion === "breath") pose.sy = 1;
      if (motion === "working") {
        pose.y = 0;
        pose.wing = 0;
      }
      if (gazeOnly) {
        const target = pointer ?? pinned ?? gazeToOffset(owlPose("idle", 0, true, hop).gaze);
        const k = 1 - Math.exp(-dt * (pointer ? 14 : 8));
        gaze.x += (target.x - gaze.x) * k;
        gaze.y += (target.y - gaze.y) * k;
        writeTransform(el.rig.style, "");
        writeTransform(el.nearWing.style, "");
        if (el.nearWingBack) writeTransform(el.nearWingBack.style, "");
        if (el.farWing && el.farWing.style.opacity !== "0") el.farWing.style.opacity = "0";
        writeTransform(el.eyes.style, "");
        writeTransform(el.pupil.style, pupilTransform(gaze));
        const blinkDur = 0.16;
        const blinkAmt =
          blinkStart >= 0 && now - blinkStart < blinkDur ? Math.sin((Math.PI * (now - blinkStart)) / blinkDur) : 0;
        writeTransform(el.lids.style, lidTransform(blinkAmt));
        const blinkingNow = blinkStart >= 0 && now - blinkStart < blinkDur;
        // the eyes still travel toward the pointer at the display rate; back
        // to rest at the resting pace; settled, nothing until the next blink
        // (or the pointer moves: setPointer)
        driven.fullRate = blinkingNow || (pointer !== null && wrote);
        if (!blinkingNow && !wrote) driven.wakeAt = blinkInCss ? Infinity : nextBlink;
        return;
      }
      if (reduce) {
        const g = pinned ?? gazeToOffset(pose.gaze);
        gaze.x = g.x;
        gaze.y = g.y;
        wingMove = null;
        writeTransform(el.rig.style, "");
        writeTransform(el.nearWing.style, "");
        if (el.nearWingBack) writeTransform(el.nearWingBack.style, "");
        if (farShown && el.farWing) {
          if (el.farWing.style.opacity !== "0") el.farWing.style.opacity = "0";
          farShown = false;
        }
        writeTransform(el.eyes.style, state === "alert" ? eyesTransform(1.15) : "");
      } else {
        const target = pointer ?? pinned ?? gazeToOffset(pose.gaze);
        const k = 1 - Math.exp(-dt * (pointer ? 14 : 6));
        gaze.x += (target.x - gaze.x) * k;
        gaze.y += (target.y - gaze.y) * k;
        writeTransform(el.rig.style, rigTransform(pose));
        const wing = wingTransform(pose.wing, pose.open);
        writeTransform(el.nearWing.style, wing);
        if (el.nearWingBack) writeTransform(el.nearWingBack.style, wing);
        if (el.farWing && (pose.open > 0 || farShown)) {
          // only touched while the wings are (or were just) out
          writeTransform(el.farWing.style, farWingTransform(pose.wing, pose.open));
          const opacity = String(farWingOpacity(pose.open));
          if (el.farWing.style.opacity !== opacity) el.farWing.style.opacity = opacity;
          farShown = pose.open > 0;
        }
        writeTransform(el.eyes.style, eyesTransform(pose.eyeScale));
      }
      writeTransform(el.pupil.style, pupilTransform(gaze));
      writeTransform(el.lids.style, lidTransform(lid));
      const blinking = blinkStart >= 0 && now - blinkStart < blinkDur;
      // A 12Hz shake or a 6Hz wing flap aliases if the whole sidebar is paced
      // down. Breathing and a held unread face do not.
      driven.fullRate = !reduce && (
        paintAgain
        || (state === "working" && motion !== "working")
        || state === "success"
        || wingMove !== null
        || blinking
        || (state === "alert" && alertPhase < 0.65)
      );
      // a steady motion in CSS: nothing to draw until the next blink
      if (motion && !driven.fullRate && !wrote) driven.wakeAt = blinkInCss ? Infinity : nextBlink;
    },
  };

  // Reduced motion keeps the blink and drops the body. A 60 fps loop that
  // only writes the lids is the same idle cost as the full pose.
  let destroyed = false;
  let blinkTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let blinkRaf = 0;
  const reduced = () => forcedReduce ?? prefersReducedMotion();

  const clearBlinkSchedule = () => {
    if (blinkTimer) {
      clearTimeout(blinkTimer);
      blinkTimer = 0;
    }
    if (blinkRaf && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(blinkRaf);
      blinkRaf = 0;
    }
  };

  const scheduleReducedBlink = (delayMs: number) => {
    if (destroyed || !reduced()) return;
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      blinkTimer = 0;
      if (destroyed) return;
      blinkPending = true;
      runReducedBlink();
    }, delayMs);
  };

  const runReducedBlink = () => {
    if (destroyed) return;
    if (!reduced()) {
      clearBlinkSchedule();
      start(driven);
      return;
    }
    if (animationsPaused()) {
      scheduleReducedBlink(1000);
      return;
    }
    if (typeof requestAnimationFrame !== "function") return;
    if (blinkRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(blinkRaf);
    let started: number | null = null;
    const dur = (base === "sleepy" ? 0.45 : 0.16) * 1000 + 40;
    const step = (ms: number) => {
      blinkRaf = 0;
      if (destroyed) return;
      if (animationsPaused()) {
        scheduleReducedBlink(1000);
        return;
      }
      if (!reduced()) {
        start(driven);
        return;
      }
      if (started === null) started = ms;
      driven.tick(ms / 1000);
      if (ms - started < dur) blinkRaf = requestAnimationFrame(step);
      else scheduleReducedBlink((base === "sleepy" ? 4 : 3) * 1000 + Math.random() * 3000);
    };
    blinkRaf = requestAnimationFrame(step);
  };

  if (gazeOnly) start(driven);
  else if (reduced()) scheduleReducedBlink(1000 + Math.random() * 4000);
  else start(driven);

  return {
    setState(state) {
      if (state === base) return;
      base = state;
      if (!beat) beatPending = true;
      // No frame loop under reduced motion, so a state change paints once.
      if (reduced()) driven.tick((typeof performance !== "undefined" ? performance.now() : 0) / 1000);
      else kick();
    },
    play(state, durationMs = 1400) {
      beat = { state, untilMs: ONE_SHOTS.has(state) ? null : durationMs };
      beatPending = true;
      if (reduced()) driven.tick((typeof performance !== "undefined" ? performance.now() : 0) / 1000);
      else kick();
    },
    blink() {
      blinkPending = true;
      if (!reduced()) {
        kick();
        return;
      }
      clearBlinkSchedule();
      runReducedBlink();
    },
    flourish(move) {
      if (reduced()) return;
      wingMove = { move, start: null };
      // A resting owl may be waiting out its slow gap. Start the move now.
      kick();
    },
    setPointer(offset) {
      if (offset === pointer) return;
      pointer = offset;
      if (!reduced() || gazeOnly) kick();
    },
    setPinnedGaze(offset) {
      pinned = offset;
      if (!reduced() || gazeOnly) kick();
    },
    setHop(value) {
      hop = value;
    },
    setReducedMotion(value) {
      forcedReduce = value;
      if (reduced()) {
        setCssMotion(null, 0);
        cancelCssBlink();
        stop(driven);
        clearBlinkSchedule();
        scheduleReducedBlink(1000 + Math.random() * 4000);
      } else {
        clearBlinkSchedule();
        start(driven);
      }
    },
    destroy() {
      destroyed = true;
      clearBlinkSchedule();
      cancelCssBlink();
      setCssMotion(null, 0);
      stop(driven);
    },
  };
}
