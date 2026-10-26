// Capture the screen to a bot by a global shortcut (parity R7, system 12):
// on macOS the bots' chord with 0 (Cmd+Shift+0 by default, next to the
// Cmd+Shift+1..9 that open a bot), on Windows Ctrl+Alt+Shift+S. A press takes one picture of the screen under the
// pointer, then brings the window up; the page puts the picture in the
// open bot's composer as an attachment. Nothing is sent: the person reads
// it, writes and sends it like any other picture.
//
// The key follows the bots' shortcuts switch (Settings > Appearance >
// Desktop) and their chord. macOS asks for Screen Recording the first time,
// for the app itself (main.mjs "screen:frame" explains why there is no
// pre-grant). Linux has no key: a capture there needs the portal's own
// prompt each time.
import { HOTKEY_MODIFIERS, DEFAULT_HOTKEY_MODIFIER } from "./system-tray.mjs";

/** A picture's longest edge, in pixels: enough to read text, bounded for the upload. */
export const CAPTURE_MAX_EDGE = 4096;

/** Windows: Ctrl+Shift+0 unhides columns in Excel and the other chords
 * with 0 clash with layouts that type with AltGr, so one fixed key there. */
export const WINDOWS_CAPTURE_ACCELERATOR = "Control+Alt+Shift+S";

export function captureAccelerator(platform = process.platform, modifier = DEFAULT_HOTKEY_MODIFIER) {
  if (platform === "win32") return WINDOWS_CAPTURE_ACCELERATOR;
  if (platform !== "darwin") return null;
  const key = Object.hasOwn(HOTKEY_MODIFIERS, modifier) ? modifier : DEFAULT_HOTKEY_MODIFIER;
  return `${HOTKEY_MODIFIERS[key]}+0`;
}

/**
 * Whether to capture, or say Screen Recording is refused. macOS gives a
 * picture of the wallpaper alone when it is refused, so a refusal is read
 * first (systemPreferences.getMediaAccessStatus("screen")). "not-determined"
 * captures: that first capture is what makes macOS ask. Elsewhere: capture.
 */
export function capturePermission(platform, status) {
  if (platform !== "darwin") return "capture";
  let value;
  try {
    value = status();
  } catch {
    return "capture";
  }
  return value === "denied" || value === "restricted" ? "denied" : "capture";
}

/** desktopCapturer's thumbnail size for a display: its real pixels, longest
 * edge at most CAPTURE_MAX_EDGE. */
export function captureThumbnailSize(display) {
  const width = Number(display?.size?.width);
  const height = Number(display?.size?.height);
  if (!(width > 0 && height > 0)) return { width: 1920, height: 1080 };
  const scale = Number(display?.scaleFactor) > 0 ? Number(display.scaleFactor) : 1;
  let w = Math.round(width * scale);
  let h = Math.round(height * scale);
  const edge = Math.max(w, h);
  if (edge > CAPTURE_MAX_EDGE) {
    w = Math.round((w * CAPTURE_MAX_EDGE) / edge);
    h = Math.round((h * CAPTURE_MAX_EDGE) / edge);
  }
  return { width: w, height: h };
}

/** The screen source of that display, else the first screen. */
export function pickCaptureSource(sources, displayId) {
  const list = Array.isArray(sources) ? sources : [];
  return list.find((source) => String(source?.display_id) === String(displayId)) ?? list[0] ?? null;
}

/**
 * The one global key. `sync(accelerator, enabled)` keeps it registered (or
 * not); a press runs `onPress` once at a time (a second press while the
 * first capture runs is dropped).
 *
 * @param {object} deps
 * @param {{ register(accelerator: string, cb: () => void): boolean; unregister(accelerator: string): void }} deps.globalShortcut
 * @param {() => unknown} deps.onPress
 * @param {(line: string) => void} [deps.log]
 */
export function createCaptureHotkey({ globalShortcut, onPress, log = () => {} }) {
  let held = null;
  let busy = false;
  let refused = null;
  const press = () => {
    if (busy) return;
    busy = true;
    let result;
    try {
      result = onPress();
    } catch {
      result = null;
    }
    Promise.resolve(result).catch(() => {}).finally(() => { busy = false; });
  };
  const release = () => {
    if (!held) return;
    try {
      globalShortcut.unregister(held);
    } catch {
      /* already gone */
    }
    held = null;
  };
  return {
    /** Returns whether the key is now held. */
    sync(accelerator, enabled = true) {
      const wanted = enabled && typeof accelerator === "string" && accelerator ? accelerator : null;
      if (held === wanted) return Boolean(held);
      release();
      if (!wanted) return false;
      let ok = false;
      try {
        ok = globalShortcut.register(wanted, press) === true;
      } catch {
        ok = false;
      }
      if (ok) {
        held = wanted;
        refused = null;
      } else if (refused !== wanted) {
        refused = wanted;
        log(`capture hotkey: ${wanted} is taken by another app; not registered`);
      }
      return ok;
    },
    get accelerator() {
      return held;
    },
    dispose() {
      release();
    },
  };
}
