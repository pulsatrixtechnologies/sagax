/**
 * A bot's character: which mascot stands for it everywhere (the avatar in
 * the sidebar, the chat, the panels, the desktop mascot), and that
 * character's own look. Stored with the bot (BotRecord.mascotLook), so every
 * device, the web and the phone see the same one.
 *
 * - owl: the Sagax owl; its color is the bot's color and its skin the bot's
 *   mascotSkin (shared/mascot-skins.ts). A stored `style` of `3d` still
 *   validates. The desktop always draws the flat owl.
 * - shape: one of the shapes (a clay body with two eyes on it), in the bot's color, with a shape skin (plain is clay).
 * - trombi: the Hibou 98 paperclip, with a Trombi skin.
 * - bunbu: Bunbu, our own collectible-vinyl little monster (long upright
 *   ears, plush body, a toothy grin), in the bot's color, with a Bunbu skin.
 * - shiba: Shiba, the dog (flat two tones and a shade, one outline), in the
 *   bot's color or a coat of its own, with a Shiba skin. It walks, wanders,
 *   turns in circles and barks on the desktop (shiba-moves.ts).
 * - grump: Grump, the grumpy cat (flat two tones and a shade, one outline),
 *   point markings in the bot's color or a coat of its own, with a Grump
 *   skin. It walks, stalks, loafs, grooms and hisses on the desktop
 *   (grump-moves.ts).
 * - ogre: Ogre, the big green ogre (the same flat style), its skin a quarter
 *   toward the bot's color and its vest in it, with an Ogre skin. It walks
 *   heavily, laughs, roars, flexes and naps on a log (ogre-moves.ts).
 * - frog: Frog, the smug sad frog (same flat style: heavy lids, wide flat
 *   lips), its skin taking a tint of the bot's color, with a Frog skin. It
 *   hops, puffs its throat, catches flies and naps on a lily pad on the
 *   desktop (frog-moves.ts).
 * - crab: Crab, the pixel-rect crab (only rectangles, a coral fill and two
 *   black square eyes), in the bot's color or a crab of its own, with a Crab
 *   skin. It scuttles, waves and hops on the desktop (crab-moves.ts).
 *
 * Each character keeps its own skin, so switching character and back finds
 * the choice made before. Absent means the owl, as every bot had before.
 */
import { z } from "zod";
import { shapeAvatarDefSchema, type ShapeAvatarDef } from "./shape-avatar-def.ts";

export const MASCOT_CHARACTERS = ["owl", "crab", "shape", "trombi", "bunbu", "shiba", "grump", "ogre", "frog"] as const;
export type MascotCharacter = (typeof MASCOT_CHARACTERS)[number];

/**
 * The shapes, in the picker's order (2026-10-28, objects 2026-11-01): the
 * bloub network's bodies (shared/mascot-geometry.json, MIT, see NOTICE), our
 * pumpkin, and eight object silhouettes (pad, cup, bulb, say, sprout, tin,
 * tome, ship) with portable JSON definitions (shared/shape-avatar-def.ts).
 * The first eight keep the ids older builds and the server already know
 * (bean is the pebble, pill the capsule, pick the triangle, drop the
 * teardrop), so a stored look keeps its place; the others are new ids.
 */
export const MASCOT_SHAPES = [
  "circle",
  "bean",
  "squircle",
  "pill",
  "pick",
  "hexagon",
  "cloud",
  "drop",
  "pumpkin",
  "egg",
  "gem",
  "wedge",
  "diamond",
  "star",
  "clover",
  "flower",
  "blossom",
  "cat",
  "ghost",
  "jellyfish",
  "axolotl",
  "puff",
  "pin",
  "marker",
  "sprite",
  "flask",
  "tube",
  "potion",
  "chomp",
  "nibble",
  "shield",
  "bubble",
  // object silhouettes (shape-engine v2, 2026-11-01): our own portable defs
  "pad",
  "cup",
  "bulb",
  "say",
  "sprout",
  "tin",
  "tome",
  "ship",
] as const;
export type MascotShape = (typeof MASCOT_SHAPES)[number];

/** Object-shaped bodies that also ship a portable JSON definition. */
export const OBJECT_MASCOT_SHAPES = ["pad", "cup", "bulb", "say", "sprout", "tin", "tome", "ship"] as const;
export type ObjectMascotShape = (typeof OBJECT_MASCOT_SHAPES)[number];

/**
 * Shapes from earlier sets: a stored look keeps working, on the nearest
 * shape of the set. Clover, flower and star are shapes of their own again
 * (2026-10-28), so a look stored with them gets them back.
 */
export const LEGACY_SHAPES: Readonly<Record<string, MascotShape>> = {
  blob: "bean",
  pebble: "bean",
  triangle: "pick",
  capsule: "pill",
  droplet: "drop",
  sparkle: "squircle",
  house: "hexagon",
};

/** The color a pumpkin takes when it is picked, where its skin paints the bot's color. */
export const PUMPKIN_COLOR = "orange";

/** The shape skins whose body is the bot's color (the others paint their own material). */
export const SHAPE_SKINS_IN_BOT_COLOR: ReadonlySet<string> = new Set(["plain", "pastel", "glossy", "outline", "crystal"]);

/**
 * Skins for the shapes; every one renders on every shape. The first four are
 * the everyday finishes; the rest are premium editions with their own idle
 * effect, equip animation and move effects (src/components/skin-fx).
 */
export const SHAPE_SKINS = ["plain", "pastel", "glossy", "night", "outline", "gold", "neon", "chrome", "crystal", "circuit", "holo", "molten", "galaxy"] as const;
export type ShapeSkin = (typeof SHAPE_SKINS)[number];

/** Skins for Trombi. */
export const TROMBI_SKINS = ["classic", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"] as const;
export type TrombiSkin = (typeof TROMBI_SKINS)[number];

/**
 * Skins for Bunbu, by rarity: everyday finishes (Plain, Pastel, Night,
 * Plush), then premium editions with their own idle effect, equip animation
 * and move effects (src/components/skin-fx/bunbu-skins.tsx).
 */
export const BUNBU_SKINS = ["plain", "pastel", "night", "plush", "velvet", "gold", "neon", "chrome", "crystal", "holo", "galaxy", "molten"] as const;
export type BunbuSkin = (typeof BUNBU_SKINS)[number];

/**
 * Skins for Shiba: the bot's color (Plain, free with it), the breed's own
 * coats (Cream, Black and tan, Red, Sesame, White: rare, each on a Mastery
 * rung, shared/mascot-unlocks.ts), then the premium set every Mastery
 * character wears, with the Trombi and Shapes treatments
 * (src/components/skin-fx/shiba-skins.tsx).
 */
export const SHIBA_SKINS = ["plain", "cream", "blacktan", "red", "sesame", "white", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"] as const;
export type ShibaSkin = (typeof SHIBA_SKINS)[number];

/**
 * Skins for Grump, by rarity: the bot's color on the points (Plain), the cat
 * coats (Tuxedo, Calico, Tabby, Siamese, Void with its lit eyes), each on a
 * Mastery rung, then premium editions with the Trombi, Shapes and Shiba
 * treatments
 * (src/components/skin-fx/grump-skins.tsx).
 */
export const GRUMP_SKINS = ["plain", "tuxedo", "calico", "tabby", "siamese", "void", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"] as const;
export type GrumpSkin = (typeof GRUMP_SKINS)[number];

/**
 * Skins for Ogre, by rarity: the bot's color (Plain) and the ogre's own
 * hides (Swamp, Moss, Stone), then the intense ones (Lava, a basalt ogre
 * with glowing cracks; Armor, plate steel for a vest) and the premium
 * editions with the Trombi, Shapes and Shiba treatments
 * (src/components/skin-fx/ogre-skins.tsx).
 */
export const OGRE_SKINS = ["plain", "swamp", "moss", "stone", "lava", "armor", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"] as const;
export type OgreSkin = (typeof OGRE_SKINS)[number];

/**
 * Skins for Frog: the bot's color (Plain, free with it), loud real frogs
 * (Leaf, Tree the red-eyed tree frog, Poison the blue dart frog, Bullfrog,
 * Ghost the see-through glass frog: rare, each on a Mastery rung,
 * shared/mascot-unlocks.ts), then the premium set every Mastery character
 * wears, with the Trombi, Shapes and Shiba treatments
 * (src/components/skin-fx/frog-skins.tsx).
 */
export const FROG_SKINS = ["plain", "leaf", "tree", "poison", "bullfrog", "ghost", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"] as const;
export type FrogSkin = (typeof FROG_SKINS)[number];

/**
 * Skins for Crab: the bot's colour tinted into the coral (Plain, free with
 * it), then the crab's own fills (Coral, Sand, Ink, Mint), all common; then
 * the premium set Shapes wears (Gold, Pearl; Neon, Chrome, Crystal, Circuit;
 * Holographic, Molten, Galaxy) with pixel marks and the shared skin-fx
 * bursts (src/components/skin-fx/crab-skins.tsx).
 */
export const CRAB_SKINS = [
  "plain",
  "coral",
  "sand",
  "ink",
  "mint",
  "gold",
  "pearl",
  "neon",
  "chrome",
  "crystal",
  "circuit",
  "holo",
  "molten",
  "galaxy",
] as const;
export type CrabSkin = (typeof CRAB_SKINS)[number];

/** How rare a skin is: the picker's label and card. */
export type SkinTier = "common" | "rare" | "epic" | "legendary";

export const SHAPE_SKIN_TIER: Readonly<Record<ShapeSkin, SkinTier>> = {
  plain: "common",
  pastel: "common",
  glossy: "common",
  night: "common",
  outline: "rare",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  crystal: "epic",
  circuit: "epic",
  holo: "legendary",
  molten: "legendary",
  galaxy: "legendary",
};

export const TROMBI_SKIN_TIER: Readonly<Record<TrombiSkin, SkinTier>> = {
  classic: "common",
  retro98: "common",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  glitch: "epic",
  holo: "legendary",
  molten: "legendary",
};

export const BUNBU_SKIN_TIER: Readonly<Record<BunbuSkin, SkinTier>> = {
  plain: "common",
  pastel: "common",
  night: "common",
  plush: "common",
  velvet: "rare",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  crystal: "epic",
  holo: "legendary",
  galaxy: "legendary",
  molten: "legendary",
};

export const SHIBA_SKIN_TIER: Readonly<Record<ShibaSkin, SkinTier>> = {
  plain: "common",
  cream: "rare",
  blacktan: "rare",
  red: "rare",
  sesame: "rare",
  white: "rare",
  retro98: "rare",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  glitch: "epic",
  holo: "legendary",
  molten: "legendary",
};

export const GRUMP_SKIN_TIER: Readonly<Record<GrumpSkin, SkinTier>> = {
  plain: "common",
  // the cat coats each cost a Mastery rung (shared/mascot-unlocks.ts): Rare, like the registry says
  tuxedo: "rare",
  calico: "rare",
  tabby: "rare",
  siamese: "rare",
  void: "rare",
  retro98: "rare",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  glitch: "epic",
  holo: "legendary",
  molten: "legendary",
};

export const OGRE_SKIN_TIER: Readonly<Record<OgreSkin, SkinTier>> = {
  plain: "common",
  swamp: "common",
  moss: "common",
  stone: "common",
  lava: "rare",
  armor: "rare",
  retro98: "rare",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  glitch: "epic",
  holo: "legendary",
  molten: "legendary",
};

export const FROG_SKIN_TIER: Readonly<Record<FrogSkin, SkinTier>> = {
  plain: "common",
  leaf: "rare",
  tree: "rare",
  poison: "rare",
  bullfrog: "rare",
  ghost: "rare",
  retro98: "rare",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  glitch: "epic",
  holo: "legendary",
  molten: "legendary",
};

export const CRAB_SKIN_TIER: Readonly<Record<CrabSkin, SkinTier>> = {
  plain: "common",
  coral: "common",
  sand: "common",
  ink: "common",
  mint: "common",
  gold: "rare",
  pearl: "rare",
  neon: "epic",
  chrome: "epic",
  crystal: "epic",
  circuit: "epic",
  holo: "legendary",
  molten: "legendary",
  galaxy: "legendary",
};

/**
 * Other names a stored skin may carry (drafts of the premium set, older
 * builds): a stored look keeps working and is saved back under the current id.
 */
export const LEGACY_SHAPE_SKINS: Readonly<Record<string, ShapeSkin>> = {
  ink: "outline",
  royal: "gold",
  metal: "chrome",
  "liquid-metal": "chrome",
  glass: "crystal",
  cyber: "circuit",
  iridescent: "holo",
  holographic: "holo",
  lava: "molten",
  nebula: "galaxy",
};
export const LEGACY_TROMBI_SKINS: Readonly<Record<string, TrombiSkin>> = {
  retro: "retro98",
  win98: "retro98",
  royal: "gold",
  metal: "chrome",
  cyber: "glitch",
  iridescent: "holo",
  holographic: "holo",
  lava: "molten",
};
export const LEGACY_BUNBU_SKINS: Readonly<Record<string, BunbuSkin>> = {
  fur: "plush",
  fuzzy: "plush",
  royal: "gold",
  metal: "chrome",
  glass: "crystal",
  iridescent: "holo",
  holographic: "holo",
  nebula: "galaxy",
  lava: "molten",
};

export const LEGACY_SHIBA_SKINS: Readonly<Record<string, ShibaSkin>> = {
  "black-and-tan": "blacktan",
  black_tan: "blacktan",
  kuro: "blacktan",
  aka: "red",
  goma: "sesame",
  shiro: "white",
  retro: "retro98",
  win98: "retro98",
  royal: "gold",
  metal: "chrome",
  cyber: "glitch",
  iridescent: "holo",
  holographic: "holo",
  lava: "molten",
};

export const LEGACY_GRUMP_SKINS: Readonly<Record<string, GrumpSkin>> = {
  tux: "tuxedo",
  "black-and-white": "tuxedo",
  tortie: "calico",
  tortoiseshell: "calico",
  tiger: "tabby",
  mackerel: "tabby",
  colorpoint: "siamese",
  colourpoint: "siamese",
  "seal-point": "siamese",
  black: "void",
  shadow: "void",
  retro: "retro98",
  win98: "retro98",
  royal: "gold",
  metal: "chrome",
  cyber: "glitch",
  iridescent: "holo",
  holographic: "holo",
  lava: "molten",
};

export const LEGACY_OGRE_SKINS: Readonly<Record<string, OgreSkin>> = {
  bog: "swamp",
  marsh: "swamp",
  forest: "moss",
  granite: "stone",
  rock: "stone",
  grey: "stone",
  gray: "stone",
  magma: "lava",
  basalt: "lava",
  iron: "armor",
  steel: "armor",
  plate: "armor",
  knight: "armor",
  retro: "retro98",
  win98: "retro98",
  royal: "gold",
  metal: "chrome",
  cyber: "glitch",
  iridescent: "holo",
  holographic: "holo",
};

export const LEGACY_CRAB_SKINS: Readonly<Record<string, CrabSkin>> = {
  classic: "coral",
  orange: "coral",
  cream: "sand",
  black: "ink",
  green: "mint",
  royal: "gold",
  treasure: "gold",
  nacre: "pearl",
  opal: "pearl",
  frost: "pearl",
  metal: "chrome",
  "liquid-metal": "chrome",
  glass: "crystal",
  cyber: "circuit",
  iridescent: "holo",
  holographic: "holo",
  lava: "molten",
  nebula: "galaxy",
};

export const LEGACY_FROG_SKINS: Readonly<Record<string, FrogSkin>> = {
  green: "leaf",
  "tree-frog": "tree",
  treefrog: "tree",
  "red-eyed": "tree",
  dart: "poison",
  "poison-dart": "poison",
  bull: "bullfrog",
  glass: "ghost",
  "glass-frog": "ghost",
  golden: "gold",
  retro: "retro98",
  win98: "retro98",
  royal: "gold",
  metal: "chrome",
  cyber: "glitch",
  iridescent: "holo",
  holographic: "holo",
  lava: "molten",
};

const legacy = (table: Readonly<Record<string, string>>) => (value: unknown) => (typeof value === "string" && Object.hasOwn(table, value) ? table[value] : value);

export const mascotLookSchema = z
  .object({
    character: z.enum(MASCOT_CHARACTERS),
    style: z.enum(["2d", "3d"]).optional(),
    shape: z.preprocess((value) => (typeof value === "string" && Object.hasOwn(LEGACY_SHAPES, value) ? LEGACY_SHAPES[value] : value), z.enum(MASCOT_SHAPES)).optional(),
    /**
     * A person's own Shape avatar definition (imported or generated). Geometry
     * only; validated by shapeAvatarDefSchema. When set on character "shape",
     * the renderer prefers it over the catalog body for that bot.
     */
    avatarDef: shapeAvatarDefSchema.optional(),
    skins: z
      .object({
        shape: z.preprocess(legacy(LEGACY_SHAPE_SKINS), z.enum(SHAPE_SKINS)).optional(),
        trombi: z.preprocess(legacy(LEGACY_TROMBI_SKINS), z.enum(TROMBI_SKINS)).optional(),
        bunbu: z.preprocess(legacy(LEGACY_BUNBU_SKINS), z.enum(BUNBU_SKINS)).optional(),
        shiba: z.preprocess(legacy(LEGACY_SHIBA_SKINS), z.enum(SHIBA_SKINS)).optional(),
        grump: z.preprocess(legacy(LEGACY_GRUMP_SKINS), z.enum(GRUMP_SKINS)).optional(),
        ogre: z.preprocess(legacy(LEGACY_OGRE_SKINS), z.enum(OGRE_SKINS)).optional(),
        frog: z.preprocess(legacy(LEGACY_FROG_SKINS), z.enum(FROG_SKINS)).optional(),
        crab: z.preprocess(legacy(LEGACY_CRAB_SKINS), z.enum(CRAB_SKINS)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type MascotLook = z.infer<typeof mascotLookSchema>;
export type { ShapeAvatarDef };

export const DEFAULT_MASCOT_LOOK: MascotLook = Object.freeze({ character: "owl" }) as MascotLook;

/**
 * A stored or received look, or the owl when absent or malformed. A skin this
 * build does not know (a newer build's) is dropped, never the whole look: the
 * character keeps its default skin instead of turning back into the owl.
 */
export function botMascotLook(value: unknown): MascotLook {
  const parsed = mascotLookSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!value || typeof value !== "object" || !("skins" in value)) return DEFAULT_MASCOT_LOOK;
  const { skins, ...rest } = value as { skins?: unknown };
  const known: Record<string, string> = {};
  if (skins && typeof skins === "object") {
    const { shape, trombi, bunbu, shiba, grump, ogre, frog, crab } = skins as { shape?: unknown; trombi?: unknown; bunbu?: unknown; shiba?: unknown; grump?: unknown; ogre?: unknown; frog?: unknown; crab?: unknown };
    const shapeSkin = legacy(LEGACY_SHAPE_SKINS)(shape);
    const trombiSkin = legacy(LEGACY_TROMBI_SKINS)(trombi);
    const bunbuSkin = legacy(LEGACY_BUNBU_SKINS)(bunbu);
    const shibaSkin = legacy(LEGACY_SHIBA_SKINS)(shiba);
    const grumpSkin = legacy(LEGACY_GRUMP_SKINS)(grump);
    const ogreSkin = legacy(LEGACY_OGRE_SKINS)(ogre);
    const frogSkin = legacy(LEGACY_FROG_SKINS)(frog);
    const crabSkin = legacy(LEGACY_CRAB_SKINS)(crab);
    if ((SHAPE_SKINS as readonly unknown[]).includes(shapeSkin)) known.shape = shapeSkin as string;
    if ((TROMBI_SKINS as readonly unknown[]).includes(trombiSkin)) known.trombi = trombiSkin as string;
    if ((BUNBU_SKINS as readonly unknown[]).includes(bunbuSkin)) known.bunbu = bunbuSkin as string;
    if ((SHIBA_SKINS as readonly unknown[]).includes(shibaSkin)) known.shiba = shibaSkin as string;
    if ((GRUMP_SKINS as readonly unknown[]).includes(grumpSkin)) known.grump = grumpSkin as string;
    if ((OGRE_SKINS as readonly unknown[]).includes(ogreSkin)) known.ogre = ogreSkin as string;
    if ((FROG_SKINS as readonly unknown[]).includes(frogSkin)) known.frog = frogSkin as string;
    if ((CRAB_SKINS as readonly unknown[]).includes(crabSkin)) known.crab = crabSkin as string;
  }
  return mascotLookSchema.safeParse(Object.keys(known).length ? { ...rest, skins: known } : rest).data ?? DEFAULT_MASCOT_LOOK;
}

/** The look with every choice filled in. */
export function completeMascotLook(value: unknown): Required<Omit<MascotLook, "skins" | "avatarDef">> & {
  skins: { shape: ShapeSkin; trombi: TrombiSkin; bunbu: BunbuSkin; shiba: ShibaSkin; grump: GrumpSkin; ogre: OgreSkin; frog: FrogSkin; crab: CrabSkin };
  avatarDef?: ShapeAvatarDef;
} {
  const look = botMascotLook(value);
  return {
    character: look.character,
    style: look.style ?? "2d",
    shape: look.shape ?? "circle",
    skins: { shape: look.skins?.shape ?? "plain", trombi: look.skins?.trombi ?? "classic", bunbu: look.skins?.bunbu ?? "plain", shiba: look.skins?.shiba ?? "plain", grump: look.skins?.grump ?? "plain", ogre: look.skins?.ogre ?? "plain", frog: look.skins?.frog ?? "plain", crab: look.skins?.crab ?? "plain" },
    ...(look.avatarDef ? { avatarDef: look.avatarDef } : {}),
  };
}

/** What a character offers in the avatar popover. */
export const CHARACTER_PAINT: Readonly<Record<MascotCharacter, { colors: boolean; skins: readonly string[]; wingMoves: boolean }>> = {
  owl: { colors: true, skins: [], wingMoves: true },
  shape: { colors: true, skins: SHAPE_SKINS, wingMoves: false },
  trombi: { colors: false, skins: TROMBI_SKINS, wingMoves: false },
  bunbu: { colors: true, skins: BUNBU_SKINS, wingMoves: false },
  shiba: { colors: true, skins: SHIBA_SKINS, wingMoves: false },
  grump: { colors: true, skins: GRUMP_SKINS, wingMoves: false },
  ogre: { colors: true, skins: OGRE_SKINS, wingMoves: false },
  frog: { colors: true, skins: FROG_SKINS, wingMoves: false },
  crab: { colors: true, skins: CRAB_SKINS, wingMoves: false },
};

/** The color Bunbu shows where no bot gives one (the app icon, the gallery): mint, our own. */
export const BUNBU_DEFAULT_COLOR = "mint";

/** The color Shiba shows where no bot gives one (the app icon, the gallery): the breed's own orange. */
export const SHIBA_DEFAULT_COLOR = "orange";

/** The color Ogre shows where no bot gives one (the app icon, the gallery): green, so the skin stays the ogre's own. */
export const OGRE_DEFAULT_COLOR = "green";

/** The color Frog shows where no bot gives one (the app icon, the gallery): green, so the skin is the approved frog green. */
export const FROG_DEFAULT_COLOR = "green";

/** The color Crab shows where no bot gives one (the app icon, the gallery): orange, mixed into the coral. */
export const CRAB_DEFAULT_COLOR = "orange";
