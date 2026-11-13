// The mascot as the page's hero (#2313, bare since JC 2026-11-08). The
// bot's profile page puts the mascot (MascotLookPreview in hero mode) large
// over its banner, no card, with the bot's name and label stacked under it.
// The page provides this slot; the mascot editor, while it is open in the
// page's Appearance sub-page, draws its hero into the slot (a portal) so the
// character picked in the grid still previews at the top, and the page
// draws the hero for the bot's own look otherwise.
import { createContext, useContext, type ReactNode } from "react";
import type { MausMotion, MausState } from "@/lib/mascot";

export interface MascotHeroSlot {
  /** The element the open editor portals its hero into (null until mounted). */
  target: HTMLElement | null;
  /** The open editor says it draws the hero, so the page does not draw its own. */
  claim: (claimed: boolean) => void;
  /** Where the character's name was: the bot's name (28px), edited in place. */
  heading: ReactNode;
  /** Under the heading: the bot's label. */
  subheading?: ReactNode;
  /** The bot's live state and the moves it plays across the app. */
  state?: MausState;
  motion?: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
}

export const MascotHeroSlotContext = createContext<MascotHeroSlot | null>(null);

export function useMascotHeroSlot(): MascotHeroSlot | null {
  return useContext(MascotHeroSlotContext);
}
