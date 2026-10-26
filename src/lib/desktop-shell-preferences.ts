// Settings > Appearance > Desktop: hardware acceleration and the spell
// checker (parity 2E). The page keeps each as "true" / "false" under its own
// key (so a bot can set it with sagax_settings, DEVICE_PREFERENCE_KEYS) and
// hands it to the desktop shell, which can only act on it itself
// (electron/desktop-shell-preferences.mjs). On this computer only: not part
// of what follows the person to another device.
import { localChoice } from "./local-choice";

export const hardwareAccelerationChoice = localChoice<"true" | "false">("sagax.hardwareAcceleration.v1", ["true", "false"], "true");
export const spellcheckChoice = localChoice<"true" | "false">("sagax.spellcheck.v1", ["true", "false"], "true");

/** Settings > Appearance > Desktop: the bots' global shortcuts (macOS menu
 * bar list, Cmd+Shift+1..9) on or off, and which chord (parity 2D). */
export const botHotkeysChoice = localChoice<"true" | "false">("sagax.botHotkeys.v1", ["true", "false"], "true");
export const BOT_HOTKEY_MODIFIERS = ["cmd-shift", "cmd-alt", "ctrl-alt"] as const;
export const botHotkeyModifierChoice = localChoice<(typeof BOT_HOTKEY_MODIFIERS)[number]>("sagax.botHotkeyModifier.v1", BOT_HOTKEY_MODIFIERS, "cmd-shift");

export function hasDesktopShellPreferences(): boolean {
  return typeof window !== "undefined" && Boolean(window.ogb?.shellPreferences);
}

function storedText(key: string): string | null {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function stored(key: string): "true" | "false" | null {
  const value = storedText(key);
  return value === "true" || value === "false" ? value : null;
}

function push(): void {
  void window.ogb?.shellPreferences?.set({
    hardwareAcceleration: hardwareAccelerationChoice.get() === "true",
    spellcheck: spellcheckChoice.get() === "true",
    botHotkeys: botHotkeysChoice.get() === "true",
    botHotkeyModifier: botHotkeyModifierChoice.get(),
  });
}

/** Start-up: a choice the shell already keeps (storage was cleared) is
 * adopted; a choice kept here is handed over; then every change goes over. */
export function installDesktopShellPreferences(): () => void {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.shellPreferences;
  if (!bridge) return () => {};
  const kept = bridge.get();
  if (kept) {
    if (stored(hardwareAccelerationChoice.key) === null && !kept.hardwareAcceleration) hardwareAccelerationChoice.set("false");
    if (stored(spellcheckChoice.key) === null && !kept.spellcheck) spellcheckChoice.set("false");
    if (stored(botHotkeysChoice.key) === null && kept.botHotkeys === false) botHotkeysChoice.set("false");
    // the chord is not a boolean: only a missing or unknown value is adopted
    const pageChoseChord = (BOT_HOTKEY_MODIFIERS as readonly string[]).includes(storedText(botHotkeyModifierChoice.key) ?? "");
    if (!pageChoseChord && kept.botHotkeyModifier && kept.botHotkeyModifier !== "cmd-shift") botHotkeyModifierChoice.set(kept.botHotkeyModifier);
  }
  const modifierKnown = (BOT_HOTKEY_MODIFIERS as readonly string[]).includes(storedText(botHotkeyModifierChoice.key) ?? "");
  if (modifierKnown || [hardwareAccelerationChoice, spellcheckChoice, botHotkeysChoice].some((choice) => stored(choice.key) !== null)) push();
  const stops = [hardwareAccelerationChoice, spellcheckChoice, botHotkeysChoice, botHotkeyModifierChoice].map((choice) => choice.subscribe(push));
  return () => stops.forEach((stop) => stop());
}
