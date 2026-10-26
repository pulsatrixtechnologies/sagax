// Choices only the desktop shell can honour: hardware acceleration (read
// before Electron is ready, so a change needs a restart) and the spell
// checker. The page keeps them in localStorage (so a bot can set them with
// sagax_settings) and hands them over; main keeps a copy in userData, like
// desktop-language.json, because the first one is needed before any page
// exists. Pure file helpers: tested without Electron.
import fs from "node:fs";
import path from "node:path";

// the chords of electron/system-tray.mjs HOTKEY_MODIFIERS
const HOTKEY_MODIFIER_NAMES = ["cmd-shift", "cmd-alt", "ctrl-alt"];
const FILE = "desktop-shell-preferences.json";
export const DEFAULT_SHELL_PREFERENCES = Object.freeze({ hardwareAcceleration: true, spellcheck: true, botHotkeys: true, botHotkeyModifier: "cmd-shift" });

/** Only booleans for the two known names; anything else is dropped. */
export function normalizeShellPreferences(value) {
  const out = {};
  if (value && typeof value === "object") {
    if (typeof value.hardwareAcceleration === "boolean") out.hardwareAcceleration = value.hardwareAcceleration;
    if (typeof value.spellcheck === "boolean") out.spellcheck = value.spellcheck;
    if (typeof value.botHotkeys === "boolean") out.botHotkeys = value.botHotkeys;
    if (HOTKEY_MODIFIER_NAMES.includes(value.botHotkeyModifier)) out.botHotkeyModifier = value.botHotkeyModifier;
  }
  return out;
}

export function readShellPreferences(userData, { fsImpl = fs } = {}) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(path.join(userData, FILE), "utf8"));
    return { ...DEFAULT_SHELL_PREFERENCES, ...normalizeShellPreferences(parsed) };
  } catch {
    return { ...DEFAULT_SHELL_PREFERENCES };
  }
}

/** Merge a patch into the stored choices (temp-and-rename). Returns the
 * stored choices, or null when the patch held nothing or the write failed. */
export function writeShellPreferences(userData, patch, { fsImpl = fs } = {}) {
  const change = normalizeShellPreferences(patch);
  if (Object.keys(change).length === 0) return null;
  const next = { ...readShellPreferences(userData, { fsImpl }), ...change };
  const file = path.join(userData, FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fsImpl.mkdirSync(userData, { recursive: true });
    fsImpl.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    fsImpl.renameSync(temporary, file);
    return next;
  } catch {
    try { fsImpl.unlinkSync(temporary); } catch { /* never created, or already renamed */ }
    return null;
  }
}
