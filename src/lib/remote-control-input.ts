// Turn browser pointer and keyboard events into the wire events of
// shared/remote-control. Pure helpers so the mapping is tested without a DOM.
import { NORM_MAX, type ControlEvent } from "../../shared/remote-control";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A point inside the displayed frame, as integers 0..NORM_MAX. Points
 * outside the frame are clamped to its edges. */
export function normalizedPoint(clientX: number, clientY: number, rect: Rect): { x: number; y: number } {
  const nx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const ny = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return { x: clamp(Math.round(nx * NORM_MAX)), y: clamp(Math.round(ny * NORM_MAX)) };
}

function clamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > NORM_MAX) return NORM_MAX;
  return value;
}

/** The browser mouse button (0 left, 1 middle, 2 right) to our button
 * (0 left, 1 right, 2 middle). */
export function mouseButton(browserButton: number): 0 | 1 | 2 | null {
  if (browserButton === 0) return 0;
  if (browserButton === 2) return 1;
  if (browserButton === 1) return 2;
  return null;
}

/** A wheel delta (pixels) to a small signed line count. */
export function wheelDelta(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const lines = Math.round(deltaY / 100) || (deltaY > 0 ? 1 : -1);
  // our wire inverts: a positive line scroll is wheel-up in SendInput, so send -lines
  return -Math.max(-50, Math.min(50, lines));
}

const NAMED_VK: Record<string, number> = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0d, Escape: 0x1b, Space: 0x20,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  Insert: 0x2d, Delete: 0x2e,
  ShiftLeft: 0x10, ShiftRight: 0x10, ControlLeft: 0x11, ControlRight: 0x11,
  AltLeft: 0x12, AltRight: 0x12,
  // Mac Command maps to Ctrl so Cmd+C and friends work on Windows; we never
  // send VK_LWIN implicitly (an explicit Win button is a separate affordance).
  MetaLeft: 0x11, MetaRight: 0x11,
  CapsLock: 0x14,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75,
  F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7a, F12: 0x7b,
};

/** Windows virtual-key code for the non-text keys we forward as key events
 * (navigation, modifiers, function keys). Printable characters go through the
 * "x" text event instead (via keypress/beforeinput), so layout is the host's
 * concern, not ours. Returns null for a key we type as text. */
export function keyToVk(code: string): number | null {
  if (Object.prototype.hasOwnProperty.call(NAMED_VK, code)) return NAMED_VK[code]!;
  return null;
}

/** True when a keydown should be forwarded as a VK key event rather than typed
 * text (navigation, editing, modifiers, shortcuts with Ctrl/Alt/Meta held). */
export function isForwardedKey(code: string, modifiers: { ctrl: boolean; alt: boolean; meta: boolean }): boolean {
  if (keyToVk(code) !== null) return true;
  return modifiers.ctrl || modifiers.alt || modifiers.meta;
}

/** The single-character VK for A-Z and 0-9, used for Ctrl/Alt shortcuts. */
export function charVk(key: string): number | null {
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  const code = upper.charCodeAt(0);
  if (code >= 0x41 && code <= 0x5a) return code; // A-Z
  if (code >= 0x30 && code <= 0x39) return code; // 0-9
  return null;
}

/** Batch events for one flush: coalesce is also done server-side, but a
 * client flush keeps WebSocket messages small. */
export function controlMessage(events: readonly ControlEvent[]): string {
  return JSON.stringify({ t: "ev", e: events });
}

export function grantMessage(on: boolean): string {
  return JSON.stringify({ t: "grant", on });
}

/** Ask the server to lift every key and button held right now (blur, tab
 * hidden): control stays on, but nothing stays stuck on the remote host. */
export function releaseMessage(): string {
  return JSON.stringify({ t: "release" });
}
