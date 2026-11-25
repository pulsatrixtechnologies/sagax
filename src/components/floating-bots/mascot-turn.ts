// Turning a shape mascot by hand (#5384): the stage of the open-bot-avatar
// site (apps/site/src/studio/Stage.tsx, 0.5.1), as pure functions. Every
// figure here is that stage's own: how far a pixel of drag turns the body,
// how far it may tip, the step of an arrow key, the 420 ms way back to the
// front. The one figure the site does not have is CLICK_SLOP: its stage does
// nothing on a click, while a click on a bot's mascot opens the mascot
// picker, so a press that barely moved stays a click.
import type { AvatarState } from "open-bot-avatar";

export interface ViewAngle {
  yaw: number;
  pitch: number;
}

export const FRONT: ViewAngle = Object.freeze({ yaw: 0, pitch: 0 });
/** How far the body tips up or down, radians. */
export const PITCH_LIMIT = 0.9;
/** Radians a pixel of drag turns the body, across and up. */
const YAW_PER_PX = 0.011;
const PITCH_PER_PX = 0.009;
/** An arrow key's turn, radians; with Shift. */
const KEY_STEP = 0.2;
const KEY_STEP_SHIFT = 0.6;
/** The way back to the front, milliseconds (an ease-out cubic). */
export const RESET_MS = 420;
/** A press that moved less than this many pixels is a click, not a drag. */
export const CLICK_SLOP = 4;

/** The six states, in the order the keys 1 to 6 pick them (the site's state pills). */
export const STAGE_STATES: readonly AvatarState[] = ["idle", "thinking", "working", "waiting", "blocked", "done"];

const clampPitch = (pitch: number) => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));

/** A yaw within -π..π, so a reset never spins the long way round. */
export function wrapYaw(yaw: number): number {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

/** Whether a press that moved this far is a drag. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= CLICK_SLOP;
}

/** The view of a drag that began at `start` and moved by (dx, dy) pixels. */
export function dragView(start: ViewAngle, dx: number, dy: number): ViewAngle {
  return { yaw: start.yaw + dx * YAW_PER_PX, pitch: clampPitch(start.pitch - dy * PITCH_PER_PX) };
}

export function isTurned(view: ViewAngle): boolean {
  return Math.abs(view.yaw) > 0.01 || Math.abs(view.pitch) > 0.01;
}

/** The view `elapsed` ms into the way back from `from`. */
export function resetView(from: ViewAngle, elapsed: number): ViewAngle {
  const t = Math.min(1, Math.max(0, elapsed / RESET_MS));
  if (t >= 1) return FRONT;
  const k = 1 - (1 - t) ** 3;
  const yaw = t === 0 && Math.abs(from.yaw) <= Math.PI ? from.yaw : wrapYaw(from.yaw);
  return { yaw: yaw * (1 - k), pitch: from.pitch * (1 - k) };
}

export type KeyAction =
  | { kind: "view"; view: ViewAngle }
  | { kind: "reset" }
  | { kind: "state"; state: AvatarState }
  | { kind: "mood"; step: 1 | -1 };

/**
 * What a key does on the mascot: 1 to 6 preview a state, M (Shift+M
 * backwards) changes the mood, the arrows turn the body, Home, 0 or Escape
 * bring a turned body back. Null leaves the key to the page (Enter and Space
 * still press the mascot's button).
 */
export function keyAction(event: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, view: ViewAngle): KeyAction | null {
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
  if (event.key === "Home" || event.key === "0" || event.key === "Escape") return isTurned(view) ? { kind: "reset" } : null;
  if (plain) {
    const state = /^[1-9]$/.test(event.key) ? STAGE_STATES[Number(event.key) - 1] : undefined;
    if (state) return { kind: "state", state };
    if (event.key === "m" || event.key === "M") return { kind: "mood", step: event.shiftKey ? -1 : 1 };
  }
  const step = event.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
  const moves: Record<string, ViewAngle> = {
    ArrowLeft: { yaw: view.yaw - step, pitch: view.pitch },
    ArrowRight: { yaw: view.yaw + step, pitch: view.pitch },
    ArrowUp: { yaw: view.yaw, pitch: clampPitch(view.pitch + step) },
    ArrowDown: { yaw: view.yaw, pitch: clampPitch(view.pitch - step) },
  };
  const next = moves[event.key];
  return next ? { kind: "view", view: { yaw: wrapYaw(next.yaw), pitch: next.pitch } } : null;
}
