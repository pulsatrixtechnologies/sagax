// The small shapes' idle life (2026-10-18): the avatars under the live loop's
// size (FX_FULL_MIN, the sidebar, rows, chips) blink now and then on one
// shared clock, and breathe with a compositor-only CSS animation
// (shape-mascot.css `shape-idle-breathe`).
//
// Cost, by design:
// - One timer for every registered avatar: it sleeps until the next blink due
//   among the avatars on screen, then one requestAnimationFrame loop runs for
//   the BLINK.length of the blinks in flight (about 11 frames) and stops.
// - One IntersectionObserver: an avatar scrolled away is skipped, and its
//   breath is paused (data-idle-hidden).
// - Nothing runs while the window is hidden (animation-pause.ts) or under
//   reduced motion (no avatar registers).
// Measured in .shots/README (headless Chromium, 24 avatars): see the PR.
import { animationsPaused, watchAnimationPause } from "@/lib/animation-pause";
import { BLINK, blinkOpen, seededRandom } from "./shape-engine";

export interface IdleShape {
  /** The element whose visibility decides whether this avatar lives (its root). */
  el: Element;
  /** A number of its own (from the bot), so each avatar keeps its rhythm. */
  seed: number;
  /** Draw the eyes this open (1 open, BLINK.floor closed). */
  blink: (open: number) => void;
}

interface Entry {
  shape: IdleShape;
  random: () => number;
  /** Next blink start, ms on the performance clock. */
  next: number;
  /** The blink starts in flight (s, on the same clock). */
  starts: number[];
  /** A blink is due: it starts on the next frame (so a late frame never skips it). */
  due: 0 | 1 | 2;
  visible: boolean;
}

const entries = new Map<symbol, Entry>();
let timer: ReturnType<typeof setTimeout> | null = null;
let raf = 0;
let observer: IntersectionObserver | null = null;
let unwatchPause: (() => void) | null = null;
/** For tests and the cost note: frames drawn since start. */
export const idleStats = { frames: 0, wakeups: 0 };

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function gap(random: () => number): number {
  return (BLINK.minGap + random() * (BLINK.maxGap - BLINK.minGap)) * 1000;
}

/** A stable seed for a string (a bot id), 0..1000. */
export function idleSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 100000) / 100;
}

function byElement(el: Element): Entry | undefined {
  for (const entry of entries.values()) if (entry.shape.el === el) return entry;
  return undefined;
}

function ensureObserver() {
  if (observer || typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver((records) => {
    for (const record of records) {
      const entry = byElement(record.target);
      if (!entry) continue;
      entry.visible = record.isIntersecting;
      if (entry.visible) record.target.removeAttribute("data-idle-hidden");
      else record.target.setAttribute("data-idle-hidden", "");
    }
    schedule();
  });
}

function frame() {
  raf = 0;
  const t = now();
  let busy = false;
  for (const entry of entries.values()) {
    if (entry.due) {
      entry.starts = entry.due === 2 ? [t / 1000, t / 1000 + BLINK.doubleAfter] : [t / 1000];
      entry.due = 0;
    }
    if (!entry.starts.length) continue;
    const open = blinkOpen(t / 1000, entry.starts);
    entry.shape.blink(open);
    idleStats.frames += 1;
    // a blink is over once its last start is past BLINK.length
    if (t / 1000 - entry.starts[entry.starts.length - 1] > BLINK.length) {
      entry.starts = [];
      entry.shape.blink(1);
    } else busy = true;
  }
  if (busy && !animationsPaused()) raf = requestAnimationFrame(frame);
  else schedule();
}

function wake() {
  timer = null;
  idleStats.wakeups += 1;
  if (animationsPaused()) return;
  const t = now();
  let started = false;
  for (const entry of entries.values()) {
    if (entry.next > t + 8) continue;
    entry.next = t + gap(entry.random);
    if (!entry.visible) continue;
    entry.due = entry.random() < BLINK.doubleChance ? 2 : 1;
    started = true;
  }
  if (started && !raf && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
  else schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (raf || !entries.size || animationsPaused()) return;
  let soonest = Infinity;
  for (const entry of entries.values()) if (entry.visible) soonest = Math.min(soonest, entry.next);
  if (!Number.isFinite(soonest)) return;
  timer = setTimeout(wake, Math.max(0, soonest - now()));
}

/** Register a small shape for the shared idle clock; returns the way out. */
export function registerIdleShape(shape: IdleShape): () => void {
  const id = Symbol("idle-shape");
  const random = seededRandom(shape.seed + 0.5);
  // the first blink lands somewhere in the first gap, so a list never blinks all at once
  entries.set(id, { shape, random, next: now() + BLINK.first * 1000 * 0.5 + random() * gap(random), starts: [], due: 0, visible: true });
  ensureObserver();
  observer?.observe(shape.el);
  if (!unwatchPause)
    unwatchPause = watchAnimationPause(() => {
      // a blink cut by a hidden window ends open, so nobody comes back half asleep
      if (animationsPaused()) {
        for (const e of entries.values()) {
          if (!e.starts.length && !e.due) continue;
          e.starts = [];
          e.due = 0;
          e.shape.blink(1);
        }
      }
      schedule();
    });
  schedule();
  return () => {
    const entry = entries.get(id);
    entries.delete(id);
    observer?.unobserve(shape.el);
    shape.el.removeAttribute("data-idle-hidden");
    if (entry?.starts.length) shape.blink(1);
    if (!entries.size) {
      if (timer) clearTimeout(timer);
      timer = null;
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      raf = 0;
      unwatchPause?.();
      unwatchPause = null;
    }
  };
}

/** Blink this avatar now (a click's reaction), on the same shared loop. */
export function blinkIdleShape(el: Element): void {
  const entry = byElement(el);
  if (!entry || animationsPaused()) return;
  entry.due = 2;
  if (timer) clearTimeout(timer);
  timer = null;
  if (!raf && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
}

/** How many avatars the clock holds (tests). */
export const idleShapeCount = () => entries.size;

/** Test hook. */
export function resetIdleShapesForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
  raf = 0;
  entries.clear();
  observer?.disconnect();
  observer = null;
  unwatchPause?.();
  unwatchPause = null;
  idleStats.frames = 0;
  idleStats.wakeups = 0;
}
