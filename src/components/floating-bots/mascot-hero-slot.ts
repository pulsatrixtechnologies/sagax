// The mascot hero card as a page header (#2313, JC 2026-11-06). The bot's
// profile page puts the Appearance > Mascot hero card (MascotLookPreview) at
// its top, with the bot's name where the character's name was, its label
// under it, and an Appearance button where Randomize was. The page provides
// this slot; the mascot editor, while it is open in the page's Appearance
// section, draws its hero card into the slot (a portal) so the character
// picked in the grid still previews at the top, and the page draws the hero
// for the bot's own look while the editor is closed.
import { createContext, useContext, type ReactNode } from "react";
import type { MausMotion, MausState } from "@/lib/mascot";

export interface MascotHeroSlot {
  /** The element the open editor portals its hero card into (null until mounted). */
  target: HTMLElement | null;
  /** The open editor says it draws the hero, so the page does not draw its own. */
  claim: (claimed: boolean) => void;
  /** Where the character's name was: the bot's name (28px), edited in place. */
  heading: ReactNode;
  /** Under the heading: the bot's label. */
  subheading?: ReactNode;
  /** Where Randomize was: the Appearance button. */
  action?: ReactNode;
  /** The bot's live state and the moves it plays across the app. */
  state?: MausState;
  motion?: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
}

export const MascotHeroSlotContext = createContext<MascotHeroSlot | null>(null);

export function useMascotHeroSlot(): MascotHeroSlot | null {
  return useContext(MascotHeroSlotContext);
}
