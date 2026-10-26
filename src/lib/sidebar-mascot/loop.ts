// One pointer listener on the sidebar and one requestAnimationFrame loop for
// every registered mascot avatar. Controllers write transforms or gaze
// imperatively so React does not repaint at display rate.

import { animationsPaused } from "../animation-pause";
import {
  gazeNormForAvatar,
  hoverLean,
  leanTransform,
  pointerInRect,
  smoothGaze,
} from "./interaction";

export type SidebarMascotDriver = {
  /** Root element whose getBoundingClientRect is the avatar box. */
  getBox: () => DOMRect | null;
  /** Pointer left the sidebar or reduced motion: rest. */
  onRest: () => void;
  /** Smoothed gaze -1..1 and hover intensity 0..1. */
  onGaze: (gaze: { x: number; y: number }, intensity: number) => void;
  /** Optional wrapper to apply lean transform on. */
  leanTarget?: HTMLElement | null;
};

type Entry = {
  driver: SidebarMascotDriver;
  gaze: { x: number; y: number };
  /** At rest and already told so: the loop leaves it alone until the pointer comes back. */
  resting: boolean;
};

let sidebarEl: HTMLElement | null = null;
let pointer: { x: number; y: number } | null = null;
let pointerInside = false;
let reduced = false;
let raf = 0;
const entries = new Map<symbol, Entry>();
let lastTs = 0;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function tick(now: number) {
  raf = 0;
  if (animationsPaused() || !sidebarEl || entries.size === 0) return;
  const dt = lastTs ? Math.min(0.1, (now - lastTs) / 1000) : 0;
  lastTs = now;

  const sidebarRect = sidebarEl.getBoundingClientRect();
  const active = !reduced && pointerInside && pointer !== null;

  // the loop runs only while something moves: the pointer is in the sidebar,
  // or a gaze is still easing back to rest. Once every avatar rests it stops
  // (it used to run at display rate forever, rewriting every avatar's face).
  let moving = false;
  for (const entry of entries.values()) {
    const box = entry.driver.getBox();
    if (!box) {
      if (!entry.resting) entry.driver.onRest();
      entry.resting = true;
      continue;
    }
    if (!active || !pointer) {
      if (entry.resting) continue;
      entry.gaze = smoothGaze(entry.gaze, { x: 0, y: 0 }, dt, 10);
      if (Math.abs(entry.gaze.x) < 0.002 && Math.abs(entry.gaze.y) < 0.002) {
        entry.driver.onRest();
        entry.gaze = { x: 0, y: 0 };
        entry.resting = true;
      } else {
        entry.driver.onGaze(entry.gaze, 0);
        moving = true;
      }
      if (entry.driver.leanTarget) entry.driver.leanTarget.style.transform = "";
      continue;
    }

    entry.resting = false;
    const norm = gazeNormForAvatar(box, pointer.x, pointer.y, sidebarRect);
    const overRow = pointerInRect(pointer.x, pointer.y, box, 10);
    const intensity = overRow ? 1 : pointerInRect(pointer.x, pointer.y, sidebarRect, 0) ? 0.55 : 0;
    const before = entry.gaze;
    entry.gaze = smoothGaze(entry.gaze, norm, dt);
    entry.driver.onGaze(entry.gaze, intensity);
    // a still pointer: the loop sleeps once every gaze has reached it (a move wakes it)
    if (dt === 0 || Math.abs(entry.gaze.x - before.x) > 0.0005 || Math.abs(entry.gaze.y - before.y) > 0.0005) moving = true;
    const lean = entry.driver.leanTarget && intensity > 0 ? hoverLean(norm, intensity) : null;
    if (entry.driver.leanTarget) {
      entry.driver.leanTarget.style.transform = lean ? leanTransform(lean) : "";
    }
  }

  if (!moving) {
    lastTs = 0;
    return;
  }
  schedule();
}

function schedule() {
  if (raf || entries.size === 0) return;
  if (typeof requestAnimationFrame !== "function") return;
  raf = requestAnimationFrame(tick);
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === "touch") return;
  if (!sidebarEl) return;
  pointer = { x: event.clientX, y: event.clientY };
  pointerInside = pointerInRect(event.clientX, event.clientY, sidebarEl.getBoundingClientRect(), 4);
  lastTs = 0;
  schedule();
}

function onScroll() {
  lastTs = 0;
  schedule();
}

function onPointerLeave() {
  pointerInside = false;
  schedule();
}

let bound = false;
function ensureListeners() {
  if (bound || !sidebarEl) return;
  bound = true;
  sidebarEl.addEventListener("pointermove", onPointerMove, { passive: true });
  sidebarEl.addEventListener("pointerleave", onPointerLeave);
  // a wheel scroll moves the avatars under a still pointer: wake the loop so the gazes follow
  sidebarEl.addEventListener("scroll", onScroll, { passive: true, capture: true });
  if (typeof window !== "undefined") {
    window.addEventListener("blur", onPointerLeave);
  }
}

export function attachSidebarMascotRoot(el: HTMLElement | null) {
  if (sidebarEl === el) return;
  if (sidebarEl && bound) {
    sidebarEl.removeEventListener("pointermove", onPointerMove);
    sidebarEl.removeEventListener("pointerleave", onPointerLeave);
    sidebarEl.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("blur", onPointerLeave);
    bound = false;
  }
  sidebarEl = el;
  if (el) ensureListeners();
}

export function registerSidebarMascot(driver: SidebarMascotDriver): () => void {
  const id = Symbol("sidebar-mascot");
  entries.set(id, { driver, gaze: { x: 0, y: 0 }, resting: true });
  schedule();
  return () => {
    entries.delete(id);
    driver.onRest();
    if (driver.leanTarget) driver.leanTarget.style.transform = "";
  };
}

export function resetSidebarMascotLoopForTests() {
  if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
  raf = 0;
  entries.clear();
  pointer = null;
  pointerInside = false;
  lastTs = 0;
}

export function setSidebarMascotReducedMotion(value: boolean) {
  reduced = value;
}

export function refreshSidebarMascotReducedMotion() {
  reduced = prefersReducedMotion();
}
