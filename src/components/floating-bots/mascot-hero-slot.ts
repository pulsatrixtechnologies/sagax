// The mascot as the page's hero (#2313, bare since JC 2026-11-08). The
// bot's profile page puts the mascot (MascotHero) large over its banner, no
// card, with the bot's name and label stacked under it. The page provides
// this slot: what the hero shows beside the bot's own look, and what a click
// on the mascot opens (the mascot picker, #5369).
import { createContext, useContext, type ReactNode } from "react";
import type { MausMotion, MausState } from "@/lib/mascot";

export interface MascotHeroSlot {
  /** Where the character's name was: the bot's name (28px), edited in place. */
  heading: ReactNode;
  /** Under the heading: the bot's label. */
  subheading?: ReactNode;
  /** The profile page's hero only: the 64px mascot in its 70px frame, with a soft drop shadow. */
  profile?: boolean;
  /** The hero's mascot opens the mascot picker: a click, with its name (tooltip and aria-label). */
  onOpen?: () => void;
  openLabel?: string;
  /** The bot's live state and the moves it plays across the app. */
  state?: MausState;
  motion?: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
}

export const MascotHeroSlotContext = createContext<MascotHeroSlot | null>(null);

export function useMascotHeroSlot(): MascotHeroSlot | null {
  return useContext(MascotHeroSlotContext);
}
