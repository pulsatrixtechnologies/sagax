// Each character's skins and how one is previewed (split out of
// MascotLookEditor.tsx): the list, the rarities, the names, and the real
// character drawn in a skin. The mascot picker's skins list and the page's
// hero share it.
import type { ReactNode } from "react";
import type { LocaleKey } from "@/locales";
import type { MausColor } from "@/lib/mascot";
import { MausAvatar } from "@/components/Avatar";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import { BUNBU_SKIN_TIER, BUNBU_SKINS, CRAB_SKIN_TIER, CRAB_SKINS, FROG_SKIN_TIER, FROG_SKINS, GRUMP_SKIN_TIER, GRUMP_SKINS, OGRE_SKIN_TIER, OGRE_SKINS, SHIBA_SKIN_TIER, SHIBA_SKINS, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS, type MascotCharacter, type ShapeSkin, type SkinTier } from "../../../shared/mascot-look";
import { ShapeMascot } from "@/components/ShapeMascot";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import { BunbuMascot } from "@/components/BunbuMascot";
import { ShibaMascot } from "@/components/ShibaMascot";
import { GrumpMascot } from "@/components/GrumpMascot";
import { OgreMascot } from "@/components/OgreMascot";
import { FrogMascot } from "@/components/FrogMascot";
import { CrabMascot } from "@/components/CrabMascot";
import { SHAPE_SKIN_LABEL, TROMBI_SKIN_LABEL, BUNBU_SKIN_LABEL, SHIBA_SKIN_LABEL, GRUMP_SKIN_LABEL, OGRE_SKIN_LABEL, FROG_SKIN_LABEL, CRAB_SKIN_LABEL } from "./mascot-look-labels";
import type { CompleteLook } from "./mascots";

export type SkinnedCharacter = Exclude<MascotCharacter, "owl">;

/** Each character's skins (but the owl's, which live on bot.mascotSkin): the list, the rarities and the names. */
export const CHARACTER_SKINS: Record<SkinnedCharacter, { skins: readonly string[]; tierOf: Readonly<Record<string, SkinTier>>; label: Readonly<Record<string, LocaleKey>> }> = {
  shape: { skins: SHAPE_SKINS, tierOf: SHAPE_SKIN_TIER, label: SHAPE_SKIN_LABEL },
  trombi: { skins: TROMBI_SKINS, tierOf: TROMBI_SKIN_TIER, label: TROMBI_SKIN_LABEL },
  bunbu: { skins: BUNBU_SKINS, tierOf: BUNBU_SKIN_TIER, label: BUNBU_SKIN_LABEL },
  shiba: { skins: SHIBA_SKINS, tierOf: SHIBA_SKIN_TIER, label: SHIBA_SKIN_LABEL },
  grump: { skins: GRUMP_SKINS, tierOf: GRUMP_SKIN_TIER, label: GRUMP_SKIN_LABEL },
  ogre: { skins: OGRE_SKINS, tierOf: OGRE_SKIN_TIER, label: OGRE_SKIN_LABEL },
  frog: { skins: FROG_SKINS, tierOf: FROG_SKIN_TIER, label: FROG_SKIN_LABEL },
  crab: { skins: CRAB_SKINS, tierOf: CRAB_SKIN_TIER, label: CRAB_SKIN_LABEL },
};

/** A skin card's live preview: the real character in that skin. */
export function skinPreview(character: MascotCharacter, skin: string, look: CompleteLook, color: MausColor, size: number): ReactNode {
  switch (character) {
    case "owl": return <MausAvatar color={color} skin={skin as MascotSkinId} state="idle" size={size} animated={false} skinAnimated trackPointer={false} />;
    case "shape": return <ShapeMascot shape={look.shape} skin={skin as ShapeSkin} color={color} size={size} detail="full" label={null} />;
    case "trombi": return <SkinnedTrombi skin={skin} pose="idle" size={size + 2} width={Math.round(size * 0.8)} detail="full" label={null} />;
    case "bunbu": return <BunbuMascot skin={skin as (typeof BUNBU_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "shiba": return <ShibaMascot skin={skin as (typeof SHIBA_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "grump": return <GrumpMascot skin={skin as (typeof GRUMP_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "ogre": return <OgreMascot skin={skin as (typeof OGRE_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "frog": return <FrogMascot skin={skin as (typeof FROG_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "crab": return <CrabMascot skin={skin as (typeof CRAB_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
  }
}
