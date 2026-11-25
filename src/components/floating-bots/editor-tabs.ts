// A character's skins grouped by rarity (Common, Rare, Epic, Legendary), as a
// pure function: the groups of the mascot picker's skins list (MascotPicker.tsx).
// It also grouped the colors by palette for the Appearance editor's tabs,
// until the picker's colour row replaced them (#5369).
import type { SkinTier } from "../../../shared/mascot-look";

/** The rarities, in order. */
export const SKIN_TIERS: readonly SkinTier[] = ["common", "rare", "epic", "legendary"];

export interface TierTab<S extends string> {
  tier: SkinTier;
  skins: S[];
  count: number;
}

/** A character's skins by rarity, in the picker's order; a rarity with no skin has no group. */
export function skinTierTabs<S extends string>(skins: readonly S[], tierOf: Readonly<Record<S, SkinTier>>): TierTab<S>[] {
  return SKIN_TIERS.map((tier) => {
    const inTier = skins.filter((skin) => tierOf[skin] === tier);
    return { tier, skins: inTier, count: inTier.length };
  }).filter((tab) => tab.count > 0);
}
