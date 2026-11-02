/**
 * The characters a bot can wear, as data a reader without the app's
 * renderers needs (the Perspicax console draws them itself from a bot's
 * `look`, server/org/org-admin-look.ts): each character's family (the
 * Appearance gallery's chips, src/components/floating-bots/wardrobe.ts),
 * whether it takes the bot's color, its skins in the picker's order and the
 * skin it wears by default. The app's registry
 * (src/components/floating-bots/mascots.tsx) stays the source of the
 * drawings; src/components/floating-bots/mascot-catalog.test.ts fails when
 * the two disagree on an id or a family.
 */
import {
  BUNBU_DEFAULT_COLOR,
  BUNBU_SKINS,
  CRAB_DEFAULT_COLOR,
  CRAB_SKINS,
  FROG_DEFAULT_COLOR,
  FROG_SKINS,
  GRUMP_SKINS,
  MASCOT_CHARACTERS,
  MASCOT_SHAPES,
  OGRE_DEFAULT_COLOR,
  OGRE_SKINS,
  SHAPE_SKINS,
  SHIBA_DEFAULT_COLOR,
  SHIBA_SKINS,
  TROMBI_SKINS,
  type MascotCharacter,
} from "./mascot-look.ts";
import { MASCOT_SKIN_IDS } from "./mascot-skins.ts";

/** The gallery's families, in its chip order. */
export const MASCOT_CATALOG_FAMILIES = ["classics", "shapes", "animals"] as const;
export type MascotCatalogFamily = (typeof MASCOT_CATALOG_FAMILIES)[number];

/** Each character's family, as the registry files it. */
export const MASCOT_FAMILY_OF: Readonly<Record<MascotCharacter, MascotCatalogFamily>> = {
  owl: "classics",
  crab: "animals",
  shape: "shapes",
  trombi: "classics",
  bunbu: "animals",
  shiba: "animals",
  grump: "animals",
  ogre: "animals",
  frog: "animals",
};

export interface MascotCatalogEntry {
  id: MascotCharacter;
  family: MascotCatalogFamily;
  /** Whether it is painted in the bot's color (Trombi is not). */
  colors: boolean;
  /** Its skins, in the picker's order. The owl's are the bot's `mascotSkin`. */
  skins: readonly string[];
  defaultSkin: string;
  /** The color it shows where no bot gives one (the gallery), when it has its own. */
  defaultColor: string | null;
  /** The shape character only: every shape, in the picker's order. */
  shapes?: readonly string[];
}

const SKINS: Readonly<Record<MascotCharacter, { skins: readonly string[]; defaultSkin: string; colors: boolean; defaultColor: string | null }>> = {
  owl: { skins: MASCOT_SKIN_IDS, defaultSkin: "none", colors: true, defaultColor: null },
  crab: { skins: CRAB_SKINS, defaultSkin: "plain", colors: true, defaultColor: CRAB_DEFAULT_COLOR },
  shape: { skins: SHAPE_SKINS, defaultSkin: "plain", colors: true, defaultColor: null },
  trombi: { skins: TROMBI_SKINS, defaultSkin: "classic", colors: false, defaultColor: null },
  bunbu: { skins: BUNBU_SKINS, defaultSkin: "plain", colors: true, defaultColor: BUNBU_DEFAULT_COLOR },
  shiba: { skins: SHIBA_SKINS, defaultSkin: "plain", colors: true, defaultColor: SHIBA_DEFAULT_COLOR },
  grump: { skins: GRUMP_SKINS, defaultSkin: "plain", colors: true, defaultColor: null },
  ogre: { skins: OGRE_SKINS, defaultSkin: "plain", colors: true, defaultColor: OGRE_DEFAULT_COLOR },
  frog: { skins: FROG_SKINS, defaultSkin: "plain", colors: true, defaultColor: FROG_DEFAULT_COLOR },
};

/** Every character, in the registry's order. */
export function mascotCatalogue(): MascotCatalogEntry[] {
  return MASCOT_CHARACTERS.map((id) => ({
    id,
    family: MASCOT_FAMILY_OF[id],
    ...SKINS[id],
    skins: [...SKINS[id].skins],
    ...(id === "shape" ? { shapes: [...MASCOT_SHAPES] } : {}),
  }));
}
