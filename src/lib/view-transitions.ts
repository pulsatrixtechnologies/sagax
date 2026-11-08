/**
 * Main view changes: opening a conversation or a thread, going to the
 * previous one, closing Settings. None uses a View Transition any more: its
 * snapshot stops the page's rendering and cost one dropped frame per
 * navigation (#2755, #2791). A main column swap (`main`) draws the new view
 * at once and slides only it in, a few pixels from the direction of travel
 * (swapMain below). A page change (`page`, Settings closing) fades the
 * leaving overlay out, then runs the update (leavePage below). Kept
 * deliberately small:
 *
 * - Input is never held: a pointer, wheel or key press during a fade skips
 *   straight to the new state.
 * - A navigation during another one finishes the first.
 * - Under reduced motion (the system setting or the in-app switch) or in a
 *   hidden window, the update simply runs now.
 * - A room (GroupView, `[data-room-view]`) on either side, or a main column
 *   that changes size (a side panel that lives outside the column on one
 *   side and inside it on the other), stands still once the update has run:
 *   a slide there read as a zoom that made people feel sick when opening a
 *   group. A room opens in place, like a 1:1 at rest (#group-open-motion).
 *
 * Chosen over React's <ViewTransition> on purpose: that one only animates
 * updates made in a React transition, and the store's updates are urgent.
 */
import { flushSync } from "react-dom";
import { prefersReducedMotion } from "./motion";

/** Which way the person travels: into something (forward) or back out. */
export type NavDirection = "forward" | "back";
/** What changes: the main column (`main`), or the page as a whole (`page`:
 * an overlay such as Settings goes, the main column stays as it was). */
export type NavScope = "main" | "page";


const SKIP_EVENTS = ["pointerdown", "wheel", "keydown"] as const;

/** The column a navigation swaps, and what it holds. */
const FRAME = ".app-content-frame";
const ROOM = "[data-room-view]";

interface FrameShape { width: number; height: number; room: boolean }

function frameShape(doc: Document): FrameShape | null {
  const frame = typeof doc.querySelector === "function" ? doc.querySelector<HTMLElement>(FRAME) : null;
  if (!frame) return null;
  const box = frame.getBoundingClientRect();
  return { width: Math.round(box.width), height: Math.round(box.height), room: Boolean(frame.querySelector(ROOM)) };
}

/** True when the swap must not animate: a room on either side, or a column
 * whose box changed (the old snapshot would be stretched into the new one). */
export function swapStandsStill(before: FrameShape | null, after: FrameShape | null): boolean {
  if (!before || !after) return false;
  return before.room || after.room || before.width !== after.width || before.height !== after.height;
}

/* A main column swap (a bot, a thread, a room) plays without a view
   transition (#2755): a transition stops the page's rendering while it
   snapshots the old view, which cost one dropped frame on every switch. The
   new view is drawn at once and only it moves in (the same fade and 8px
   slide the main column used to take), on the compositor, while the old one is simply
   gone. Input is never held: the column takes clicks while it fades in. */
const ENTER_MS = 200;
const ENTER_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
let entering: Animation | null = null;

function swapMain(doc: Document, update: () => void, direction: NavDirection): void {
  const before = frameShape(doc);
  entering?.cancel();
  entering = null;
  flushSync(update);
  const after = frameShape(doc);
  if (swapStandsStill(before, after)) return;
  const frame = typeof doc.querySelector === "function" ? doc.querySelector<HTMLElement>(FRAME) : null;
  if (!frame || typeof frame.animate !== "function") return;
  const offset = direction === "back" ? -8 : 8;
  const animation = frame.animate(
    [{ opacity: 0, transform: `translateX(${offset}px)` }, { opacity: 1, transform: "none" }],
    { duration: ENTER_MS, easing: ENTER_EASE },
  );
  entering = animation;
  void animation.finished.catch(() => {}).finally(() => { if (entering === animation) entering = null; });
}

/* A page change (Settings closing) plays without a view transition either
   (#2791): its snapshot cost one dropped frame per close. The leaving
   overlay fades out on the compositor, then the update runs; without one
   the update simply runs now. Any input, or another navigation, finishes the
   fade at once, so a click is never held. */
const LEAVE_MS = 120;
const LEAVE_EASE = "cubic-bezier(0.4, 0, 1, 1)";
let leaving: { animation: Animation; done: () => void } | null = null;

function finishLeaving(): void {
  const current = leaving;
  if (!current) return;
  leaving = null;
  current.done();
}

function leavePage(update: () => void, element: HTMLElement | null | undefined): void {
  finishLeaving();
  if (!element || typeof element.animate !== "function") {
    flushSync(update);
    return;
  }
  const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LEAVE_MS, easing: LEAVE_EASE, fill: "forwards" });
  let ran = false;
  const skip = () => finishLeaving();
  const done = () => {
    if (ran) return;
    ran = true;
    for (const type of SKIP_EVENTS) window.removeEventListener(type, skip, { capture: true });
    flushSync(update);
    // the overlay is gone; if it stayed, it must not stay see-through
    animation.cancel();
  };
  leaving = { animation, done };
  for (const type of SKIP_EVENTS) window.addEventListener(type, skip, { capture: true, passive: true });
  void animation.finished.then(() => {
    if (leaving?.animation !== animation) return;
    leaving = null;
    done();
  }, () => {});
}

/** Run `update` (a store dispatch, a state change) as a navigation. A page
 * change takes the overlay that leaves (`leavingElement`) to fade it out. */
export function navigate(update: () => void, direction: NavDirection = "forward", scope: NavScope = "main", leavingElement?: HTMLElement | null): void {
  const doc = typeof document === "undefined" ? null : document;
  if (!doc || prefersReducedMotion() || doc.visibilityState === "hidden") {
    finishLeaving();
    update();
    return;
  }
  if (scope === "main") {
    finishLeaving();
    swapMain(doc, update, direction);
    return;
  }
  leavePage(update, leavingElement);
}
