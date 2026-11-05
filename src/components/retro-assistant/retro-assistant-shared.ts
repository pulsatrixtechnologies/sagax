import type { LocaleKey } from "@/locales";
import type { RetroAnimation, RetroCharacter, RetroGuess, RetroTip } from "./logic";

export type MenuItem = "hide" | "options" | "gallery" | "animate" | "detach" | "attach";

/** A balloon described as data, so the page and the detached window draw the same one. */
export interface BalloonModel {
  tipHead?: boolean;
  text?: string;
  question?: string;
  bullets: Array<{ id: string; label: string; run: () => void }>;
  buttons: Array<{ id: string; label: string; primary?: boolean; run: () => void }>;
  ask?: boolean;
}

export type Balloon =
  | { kind: "welcome" }
  | { kind: "tip"; tip: RetroTip }
  | { kind: "guess"; guess: RetroGuess }
  | { kind: "results"; query: string; tips: RetroTip[] };

export type Act = { name: RetroAnimation | "enter" | "leave" | "celebrate"; n: number };

export const TIP_EVERY_MS = 45_000;
export const COMPOSER = '[data-tour="composer"]';
export const MENU_IDS = new Set<string>(["hide", "options", "gallery", "animate", "detach", "attach"]);

export function inComposer(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && Boolean(target.closest(COMPOSER));
}

/**
 * Where the assistant stands by default: bottom right of the conversation,
 * just above the composer, so it never sits on a field or on the Send button.
 */
export function perchAboveComposer(): { right: number; bottom: number } {
  const composer = typeof document === "undefined" ? null : document.querySelector(COMPOSER);
  if (!composer) return { right: 24, bottom: 120 };
  const rect = composer.getBoundingClientRect();
  return {
    right: Math.max(8, window.innerWidth - rect.right + 22),
    bottom: Math.max(8, window.innerHeight - rect.top + 6),
  };
}

/** The assistant's accessible name and greeting follow the character. */
export function characterStrings(character: RetroCharacter): { aria: LocaleKey; welcome: LocaleKey } {
  if (character === "owl") return { aria: "retro.aria.owl", welcome: "retro.welcome" };
  if (character === "custom") return { aria: "retro.aria.custom", welcome: "retro.welcome.custom" };
  return { aria: "retro.aria.trombi", welcome: "retro.welcome.trombi" };
}
