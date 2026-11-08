/**
 * Main view changes: opening a conversation or a thread, going to the
 * previous one, closing Settings. A page change (`page`, Settings closing)
 * is a View Transition (document.startViewTransition): the browser
 * snapshots the old frame, the update is flushed synchronously inside the
 * transition, then it cross-fades (styles.css "View transitions"). A main
 * column swap (`main`) draws the new view at once and slides only it in, a
 * few pixels from the direction of travel (swapMain below). Kept
 * deliberately small:
 *
 * - Input is never held: the pseudo-elements take no pointer events, and a
 *   pointer, wheel or key press during the transition skips straight to the
 *   new state (the update has already run or runs at once).
 * - A navigation during another one skips the first.
 * - Without the API, under reduced motion (the system setting or the in-app
 *   switch) or in a hidden window, the update simply runs now.
 * - A room (GroupView, `[data-room-view]`) on either side, or a main column
 *   that changes size (a side panel that lives outside the column on one
 *   side and inside it on the other), skips the animation once the update
 *   has run: the browser would otherwise morph the snapshot from the old
 *   box to the new one, a zoom that made people feel sick when opening a
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

let running: ViewTransition | null = null;

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
   slide as `vt-in-forward`), on the compositor, while the old one is simply
   gone. Input is never held: the column takes clicks while it fades in. */
const ENTER_MS = 200;
const ENTER_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
let entering: Animation | null = null;

function swapMain(doc: Document, update: () => void, direction: NavDirection): void {
  const before = frameShape(doc);
  entering?.cancel();
  entering = null;
  running?.skipTransition();
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

/** Run `update` (a store dispatch, a state change) as a view transition. */
export function navigate(update: () => void, direction: NavDirection = "forward", scope: NavScope = "main"): void {
  const doc = typeof document === "undefined" ? null : document;
  if (!doc || prefersReducedMotion() || doc.visibilityState === "hidden") {
    update();
    return;
  }
  if (scope === "main") {
    swapMain(doc, update, direction);
    return;
  }
  if (typeof doc.startViewTransition !== "function") {
    update();
    return;
  }
  running?.skipTransition();
  const root = doc.documentElement;
  root.dataset.nav = scope;
  root.dataset.navDirection = direction;
  const before = frameShape(doc);
  let transition: ViewTransition | undefined;
  const apply = () => {
    flushSync(update);
    if (swapStandsStill(before, frameShape(doc))) transition?.skipTransition();
  };
  try {
    transition = doc.startViewTransition({ update: apply, types: [`nav-${direction}`, `nav-${scope}`] });
  } catch {
    // an engine that only takes the callback form
    transition = doc.startViewTransition(apply);
  }
  running = transition;
  const started = transition;
  const skip = () => started.skipTransition();
  for (const type of SKIP_EVENTS) window.addEventListener(type, skip, { capture: true, passive: true });
  // a failed update is the caller's error, not the animation's
  started.updateCallbackDone.catch((error: unknown) => console.error(error));
  void started.finished.catch(() => {}).finally(() => {
    for (const type of SKIP_EVENTS) window.removeEventListener(type, skip, { capture: true });
    if (running !== started) return;
    running = null;
    delete root.dataset.nav;
    delete root.dataset.navDirection;
  });
}
