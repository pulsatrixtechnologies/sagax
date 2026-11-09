// The desktop balloon wears the app's theme: the skin chosen in the app (each
// skin is a light or dark palette of tokens, styles.css) and the brand's
// accent, sent by the brain in every snapshot and stamped on the floating
// window's document, so a change in the app reaches the balloon at once.
// The floating window makes no request and may not share the app page's
// storage (server mode), so it never reads the skin from storage itself.
// Trombi keeps its own Hibou 98 look whatever the theme (FloatingBotView).
import { useEffect, useState } from "react";
import { accentInk, accentTextValue } from "@/lib/brand";
import { SKIN_IDS, type SkinId } from "@/lib/skins";
import { BRAND_BUBBLE_VARS, brandBubbleVars } from "@/lib/bubble-colors";
import { BRAND_SWITCH_VARS, brandSwitchVars } from "@/lib/switch-colors";

export interface FloatingTheme {
  /** The app's skin (src/lib/skins.ts). */
  skin: SkinId;
  /** The brand's accent, when the deployment sets one (#rrggbb). */
  accent?: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const ACCENT_VARS = ["--color-accent", "--color-accent-border", "--color-focus", "--color-accent-text", "--color-accent-ink", ...BRAND_SWITCH_VARS, ...BRAND_BUBBLE_VARS] as const;

export const isSkinId = (value: unknown): value is SkinId => typeof value === "string" && (SKIN_IDS as readonly string[]).includes(value);

/** The app page's theme, as stamped on its document (applySkin, applyBrand). */
export function readAppTheme(root: HTMLElement | undefined = typeof document === "undefined" ? undefined : document.documentElement): FloatingTheme | undefined {
  if (!root) return undefined;
  const skin = root.dataset.skin;
  if (!isSkinId(skin)) return undefined;
  const accent = root.style.getPropertyValue("--color-accent").trim();
  return HEX.test(accent) ? { skin, accent } : { skin };
}

const themeKey = (theme: FloatingTheme | undefined) => (theme ? `${theme.skin}|${theme.accent ?? ""}` : "");

/**
 * The app page's theme, followed live: a skin picked or a brand accent
 * applied re-renders the brain, whose next snapshot carries it.
 */
export function useAppTheme(): FloatingTheme | undefined {
  const [theme, setTheme] = useState(() => readAppTheme());
  useEffect(() => {
    const root = typeof document === "undefined" ? undefined : document.documentElement;
    if (!root || typeof MutationObserver === "undefined") return;
    const check = () => setTheme((current) => {
      const next = readAppTheme(root);
      return themeKey(next) === themeKey(current) ? current : next;
    });
    const observer = new MutationObserver(check);
    observer.observe(root, { attributes: true, attributeFilter: ["data-skin", "style"] });
    check();
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** A theme from a snapshot: known skins and a plain hex accent only. */
export function cleanTheme(value: unknown): FloatingTheme | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { skin, accent } = value as { skin?: unknown; accent?: unknown };
  if (!isSkinId(skin)) return undefined;
  return typeof accent === "string" && HEX.test(accent) ? { skin, accent } : { skin };
}

/** The custom properties a theme sets on the window's root, besides its skin (an empty value removes one). */
export function themeVars(theme: FloatingTheme | undefined): Record<string, string> {
  const vars: Record<string, string> = Object.fromEntries(ACCENT_VARS.map((name) => [name, ""]));
  if (!theme?.accent) return vars;
  return {
    "--color-accent": theme.accent,
    "--color-accent-border": theme.accent,
    "--color-focus": theme.accent,
    "--color-accent-text": accentTextValue(theme.accent),
    "--color-accent-ink": accentInk(theme.accent),
    ...brandSwitchVars(theme.accent),
    ...brandBubbleVars(theme.accent),
  };
}

/** Stamp a theme on the floating window's document; without one, the window keeps its own default. */
export function applyFloatingTheme(theme: FloatingTheme | undefined, root: HTMLElement = document.documentElement): void {
  if (!theme) return;
  // the Hibou 98 skin brings a stylesheet of its own (as applySkin does)
  if (theme.skin === "retro98") void import("../../styles/retro98.css").catch(() => undefined);
  if (root.dataset.skin !== theme.skin) root.dataset.skin = theme.skin;
  for (const [name, value] of Object.entries(themeVars(theme))) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
}
