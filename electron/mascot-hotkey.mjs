// The desktop mascot's global hotkey (Control+Option+Space by default): a
// press anywhere on the desktop reaches the app page (the floating bots'
// brain), which starts the call with the mascot's bot, mutes or unmutes it,
// or talks while the keys are held (push to talk). This module only owns the
// key: it registers it with Electron's globalShortcut while the brain asks
// for it (the setting is on and a mascot is shown), never twice, and lets it
// go when the brain says so, when every mascot is hidden and when the app
// quits.
//
// globalShortcut reports a press, never a release. Telling a tap from a hold
// needs the keys' state: on macOS a small probe (osascript, JavaScript for
// Automation, reading NSEvent.modifierFlags) watches the chord's modifiers
// for the length of one press, and only when the brain says a hold means
// something (push to talk on a call). Elsewhere, or without a probe, every
// press is a tap. It reads no key but the chord's modifiers, needs no
// Accessibility grant and stops as soon as they are up.
import { spawn as nodeSpawn } from "node:child_process";

/** The choices offered in Settings (Electron accelerators). */
export const HOTKEY_CHOICES = Object.freeze(["Control+Alt+Space", "Control+Shift+Space", "Alt+Shift+Space"]);
export const DEFAULT_HOTKEY = HOTKEY_CHOICES[0];
/** Held longer than this, a press is a hold (push to talk). */
export const HOLD_MS = 350;
/** The probe's first answer may take this long (osascript starts in about 300 ms). */
export const PROBE_WAIT_MS = 1200;
/** A hold never lasts longer than this: the probe stops and the talk is released. */
export const HOLD_MAX_MS = 120_000;

/** What the brain may ask of the key, checked: anything else is off. */
export function sanitizeHotkeyConfig(value) {
  const record = value && typeof value === "object" ? value : {};
  return {
    enabled: record.enabled === true,
    accelerator: HOTKEY_CHOICES.includes(record.accelerator) ? record.accelerator : DEFAULT_HOTKEY,
    hold: record.hold === true,
  };
}

/** NSEvent's modifier flags for the chord's modifiers (Space is not a modifier and is not read). */
const MAC_FLAGS = { Shift: 1 << 17, Control: 1 << 18, Alt: 1 << 19, Option: 1 << 19, Command: 1 << 20, Cmd: 1 << 20, CommandOrControl: 1 << 20, CmdOrCtrl: 1 << 20, Super: 1 << 20 };

export function modifierMask(accelerator) {
  return String(accelerator)
    .split("+")
    .reduce((mask, part) => mask | (MAC_FLAGS[part.trim()] ?? 0), 0);
}

/** The probe's script: prints 1 while every modifier of the mask is down, 0 once one is up, then ends. */
export function probeScript(mask, maxMs = HOLD_MAX_MS) {
  const flags = Math.max(0, Math.floor(Number(mask) || 0));
  const limit = Math.max(0, Math.floor(Number(maxMs) || 0));
  return [
    'ObjC.import("Cocoa");',
    `var mask = ${flags}; var last = -1; var until = Date.now() + ${limit};`,
    "while (Date.now() < until) {",
    "  var down = (($.NSEvent.modifierFlags & mask) === mask) ? 1 : 0;",
    "  if (down !== last) { console.log(String(down)); last = down; }",
    "  if (!down) break;",
    "  delay(0.03);",
    "}",
  ].join("\n");
}

/**
 * macOS: a probe of the chord's modifiers for one press. `onChange(down)` is
 * called with the first reading and every change; the probe ends by itself
 * once they are up. Elsewhere: null (every press is a tap).
 */
export function createModifierProbe({ platform = process.platform, spawn = nodeSpawn } = {}) {
  if (platform !== "darwin") return null;
  return (accelerator, onChange) => {
    const mask = modifierMask(accelerator);
    if (!mask) return null;
    let child;
    try {
      child = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", probeScript(mask)], { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return null;
    }
    let buffer = "";
    // JavaScript for Automation's console.log writes to stderr; read both
    const read = (chunk) => {
      buffer += String(chunk);
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line === "1" || line === "0") onChange(line === "1");
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on?.("error", () => onChange(false));
    return {
      stop() {
        try {
          if (child.exitCode === null && !child.killed) child.kill();
        } catch {
          /* already gone */
        }
      },
    };
  };
}

/**
 * The hotkey. `notify(kind)` reaches the brain: "tap" (a press), "hold"
 * (held past HOLD_MS while `hold` is asked) and "release" (the end of a
 * hold). `configure` is idempotent: the same accelerator is never
 * registered twice; another one replaces it.
 *
 * @param {object} deps
 * @param {{ register(accelerator: string, cb: () => void): boolean; unregister(accelerator: string): void; isRegistered?(accelerator: string): boolean }} deps.globalShortcut
 * @param {(kind: "tap" | "hold" | "release") => void} deps.notify
 * @param {((accelerator: string, onChange: (down: boolean) => void) => ({ stop(): void } | null)) | null} [deps.probe]
 * @param {(line: string) => void} [deps.log]
 * @param {() => number} [deps.now]
 * @param {typeof setTimeout} [deps.setTimer]
 * @param {typeof clearTimeout} [deps.clearTimer]
 */
export function createMascotHotkey(deps) {
  const { globalShortcut, notify } = deps;
  const probe = deps.probe ?? null;
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  let config = sanitizeHotkeyConfig(null);
  /** The accelerator registered now, or null. */
  let registered = null;
  /** One press at a time: "deciding" (tap or hold?) then "holding". */
  let press = null;

  const endPress = () => {
    if (!press) return;
    for (const timer of press.timers) clearTimer(timer);
    try {
      press.handle?.stop();
    } catch {
      /* already gone */
    }
    press = null;
  };
  const tap = () => {
    endPress();
    notify("tap");
  };
  const startHold = () => {
    if (!press || press.phase !== "deciding") return;
    press.phase = "holding";
    // a hold that never ends (the probe died) is released all the same
    press.timers.push(setTimer(() => release(), HOLD_MAX_MS));
    notify("hold");
  };
  const release = () => {
    if (!press) return;
    const held = press.phase === "holding";
    endPress();
    if (held) notify("release");
  };
  const decide = () => {
    if (!press || press.phase !== "deciding") return;
    if (press.down === true) startHold();
    else if (press.down === false) tap();
    // no reading yet: the probe's first answer decides, or a tap after PROBE_WAIT_MS
  };

  const onPress = () => {
    // a key repeat, or a press while one is still being read: the same press
    if (press) return;
    if (!config.hold || !probe) {
      notify("tap");
      return;
    }
    const started = now();
    press = { phase: "deciding", down: null, started, timers: [], handle: null };
    const mine = press;
    const handle = probe(registered ?? config.accelerator, (down) => {
      if (press !== mine) return;
      press.down = down;
      if (press.phase === "holding") {
        if (!down) release();
        return;
      }
      if (!down) tap();
      else if (now() - started >= HOLD_MS) startHold();
    });
    if (!handle) {
      press = null;
      notify("tap");
      return;
    }
    mine.handle = handle;
    mine.timers.push(setTimer(decide, HOLD_MS));
    mine.timers.push(setTimer(() => {
      if (press === mine && press.phase === "deciding") tap();
    }, PROBE_WAIT_MS));
  };

  const unregister = () => {
    if (!registered) return;
    try {
      globalShortcut.unregister(registered);
    } catch {
      /* already gone */
    }
    registered = null;
  };

  return {
    /** The brain's wish, checked: on (with an accelerator) or off. Returns what holds now. */
    configure(value) {
      const next = sanitizeHotkeyConfig(value);
      const before = config;
      config = next;
      if (!next.enabled) {
        release();
        unregister();
        return { registered: null, conflict: false };
      }
      // a hold asked no more: a press under way ends as it is
      if (before.hold && !next.hold) release();
      if (registered === next.accelerator) return { registered, conflict: false };
      release();
      unregister();
      let ok = false;
      try {
        ok = globalShortcut.register(next.accelerator, onPress) === true;
      } catch {
        ok = false;
      }
      if (!ok) {
        // another app holds it (or the system refused): say so once, stay off
        log(`mascot hotkey: ${next.accelerator} is taken by another app; not registered`);
        return { registered: null, conflict: true };
      }
      registered = next.accelerator;
      return { registered, conflict: false };
    },
    /** Every mascot is hidden, or the app page went away: let the key go. */
    disable() {
      config = { ...config, enabled: false };
      release();
      unregister();
    },
    get registered() {
      return registered;
    },
    /** For tests: whether a press is being read or held now. */
    get pressing() {
      return press ? press.phase : null;
    },
    dispose() {
      this.disable();
    },
  };
}

/**
 * Global shortcuts that open a bot: Cmd+Shift+N (Ctrl+Shift+N elsewhere) for
 * the bot in slot N of the menu bar list. One key per listed bot, no more;
 * the keys follow the roster and are all let go when it is empty, when the
 * person turns them off and when the app quits. `slotFor(n)` gives the
 * accelerator of a slot (null: that slot has none, e.g. macOS screenshots).
 *
 * @param {object} deps
 * @param {{ register(accelerator: string, cb: () => void): boolean; unregister(accelerator: string): void }} deps.globalShortcut
 * @param {(slot: number) => void} deps.onSlot  a press of slot N (1 based)
 * @param {(slot: number) => string | null} deps.slotFor
 * @param {(line: string) => void} [deps.log]
 */
export function createBotHotkeys({ globalShortcut, onSlot, slotFor, log = () => {} }) {
  /** slot -> accelerator now registered */
  const held = new Map();
  const release = (slot) => {
    const accelerator = held.get(slot);
    if (!accelerator) return;
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      /* already gone */
    }
    held.delete(slot);
  };
  return {
    /** Keep exactly slots 1..count registered. Returns the slots held. */
    sync(count, enabled = true) {
      const wanted = enabled ? Math.max(0, Math.min(9, Math.floor(Number(count) || 0))) : 0;
      for (const slot of held.keys()) if (slot > wanted) release(slot);
      for (let slot = 1; slot <= wanted; slot++) {
        if (held.has(slot)) continue;
        const accelerator = slotFor(slot);
        if (!accelerator) continue;
        let ok = false;
        try {
          ok = globalShortcut.register(accelerator, () => onSlot(slot)) === true;
        } catch {
          ok = false;
        }
        if (ok) held.set(slot, accelerator);
        else log(`bot hotkey: ${accelerator} is taken by another app; not registered`);
      }
      return [...held.keys()].sort((a, b) => a - b);
    },
    get slots() {
      return [...held.keys()].sort((a, b) => a - b);
    },
    dispose() {
      for (const slot of held.keys()) release(slot);
    },
  };
}
