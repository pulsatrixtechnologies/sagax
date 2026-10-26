// Settings > Appearance > Mascots > "HD mascots": a character that ships
// painted art (src/components/hd-mascots, Shiba for now) shows it instead of
// its code-drawn vector look. On by default; off brings the classic vector
// mascot back everywhere. A preference of the person, kept like the other
// appearance choices (localStorage, and per person on an organization
// server through shared/user-preferences.ts), applied live: every mascot
// reads it through useHdMascots(), so a change shows without a reload.
import { useSyncExternalStore } from "react";
import { localChoice } from "./local-choice";

export const HD_MASCOTS_KEY = "sagax.hdMascots.v1";
export const HD_MASCOTS_CHOICES = ["on", "off"] as const;
export type HdMascotsChoice = (typeof HD_MASCOTS_CHOICES)[number];

export const hdMascotsChoice = localChoice<HdMascotsChoice>(HD_MASCOTS_KEY, HD_MASCOTS_CHOICES, "on");

/** True when HD mascots are on (the default). */
export function hdMascotsEnabled(): boolean {
  return hdMascotsChoice.get() === "on";
}

export function setHdMascotsEnabled(next: boolean): void {
  hdMascotsChoice.set(next ? "on" : "off");
}

/** The choice, followed live (this window, another window, a bot, another device). */
export function useHdMascots(): boolean {
  // the stored choice on the server render too (static renders, tests): the app never hydrates
  return useSyncExternalStore(hdMascotsChoice.subscribe, hdMascotsChoice.get, hdMascotsChoice.get) === "on";
}
