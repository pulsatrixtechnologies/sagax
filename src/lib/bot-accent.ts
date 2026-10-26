// Settings > Appearance > "Use bot color as accent": the app's accent follows
// the open bot's mascot color. Off by default; the skin's (and its colour's)
// accent stays whenever no bot is open or the bot has no colour.
//
// The variables are set on <body>, never on <html>: the skin and a deployment
// brand write theirs on the root, so clearing the body's puts theirs back
// with nothing to remember. Menus and dialogs portal into <body>, so they
// follow too. A bot colour is chosen for a mascot, not for text: before it
// becomes the accent it is darkened (light skins) or lifted (dark skins)
// until it holds 3:1 as a fill and 4.5:1 as text on the skin's panel, and the
// text drawn on it is white or near black, whichever reads (WCAG AA).
import { useEffect, useSyncExternalStore } from "react";
import { prefersReducedMotion } from "./motion";

export const BOT_ACCENT_KEY = "sagax.botAccent.v1";

export const BOT_ACCENT_VARS = ["--color-accent", "--color-accent-border", "--color-focus", "--color-accent-text", "--color-accent-ink"] as const;

const HEX = /^#([0-9a-f]{6})$/i;
const SHORT_HEX = /^#([0-9a-f]{3})$/i;

/** #rgb or #rrggbb (any case) as #rrggbb, else null. */
export function normalizeHex(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  if (HEX.test(text)) return text.toLowerCase();
  const short = SHORT_HEX.exec(text);
  if (short) return `#${[...short[1]!].map((c) => c + c).join("")}`.toLowerCase();
  return null;
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminanceOf(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `color` mixed toward black (a light surface) or white (a dark one) in
 * small steps until it holds `ratio` against `surface`. */
export function holdContrast(color: string, surface: string, ratio: number): string {
  if (contrast(color, surface) >= ratio) return color;
  const target: [number, number, number] = luminanceOf(surface) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const from = channels(color);
  for (let step = 1; step <= 40; step++) {
    const t = step / 40;
    const mixed = toHex([0, 1, 2].map((i) => from[i]! + (target[i]! - from[i]!) * t) as [number, number, number]);
    if (contrast(mixed, surface) >= ratio) return mixed;
  }
  return toHex(target);
}

/** White or black, whichever reads on `fill`: one of the two always holds
 * 4.5:1 (near black, as the brand accent uses, falls short on mid tones). */
export function inkOn(fill: string): string {
  return contrast("#ffffff", fill) >= contrast("#000000", fill) ? "#ffffff" : "#000000";
}

/** The accent variables for a bot colour on a skin whose panel is `surface`;
 * null (keep the skin's accent) when either is not a colour. */
export function botAccentVars(color: string | null | undefined, surface: string | null | undefined): Record<(typeof BOT_ACCENT_VARS)[number], string> | null {
  const hex = normalizeHex(color);
  const panel = normalizeHex(surface);
  if (!hex || !panel) return null;
  const fill = holdContrast(hex, panel, 3);
  const text = holdContrast(hex, panel, 4.5);
  return {
    "--color-accent": fill,
    "--color-accent-border": fill,
    "--color-focus": fill,
    "--color-accent-text": text,
    "--color-accent-ink": inkOn(fill),
  };
}

// ---- the preference (a renderer choice, it travels like the skin) ----

let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function botAccentEnabled(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(BOT_ACCENT_KEY) === "1";
  } catch {
    return false;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== BOT_ACCENT_KEY && event.key !== null) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function setBotAccentEnabled(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    if (enabled) storage()?.setItem(BOT_ACCENT_KEY, "1");
    else storage()?.removeItem(BOT_ACCENT_KEY);
  } catch {
    // the choice still holds for this session
  }
  notify();
}

export function useBotAccentEnabled(): boolean {
  return useSyncExternalStore(subscribe, botAccentEnabled, () => false);
}

// ---- applying it ----

let registered = false;

/** Lets the accent glide between bots: a registered colour property
 * interpolates where a plain custom property would jump. */
function registerAccentProperties(): void {
  if (registered || typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return;
  registered = true;
  for (const name of ["--color-accent", "--color-accent-text"]) {
    try {
      CSS.registerProperty({ name, syntax: "<color>", inherits: true, initialValue: "#3b82f6" });
    } catch {
      // already registered (a hot reload): nothing to do
    }
  }
}

function panelColor(): string | null {
  if (typeof document === "undefined") return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--color-panel");
  return normalizeHex(value);
}

/** Put the open bot's colour on the accent while the setting is on. */
export function useBotAccent(color: string | null | undefined): void {
  const enabled = useBotAccentEnabled();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    const vars = enabled ? botAccentVars(color, panelColor()) : null;
    if (vars) {
      registerAccentProperties();
      body.style.transition = prefersReducedMotion() ? "" : "--color-accent 240ms ease, --color-accent-text 240ms ease";
      for (const [name, value] of Object.entries(vars)) body.style.setProperty(name, value);
    } else {
      for (const name of BOT_ACCENT_VARS) body.style.removeProperty(name);
    }
  }, [enabled, color]);
  useEffect(() => () => {
    if (typeof document === "undefined") return;
    for (const name of BOT_ACCENT_VARS) document.body.style.removeProperty(name);
    document.body.style.transition = "";
  }, []);
}
