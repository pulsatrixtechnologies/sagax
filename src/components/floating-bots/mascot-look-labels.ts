// Locale key tables of the mascot look editor (split out of MascotLookEditor.tsx).

import type { LocaleKey } from "@/locales";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import type { MascotColorGroup } from "../../../shared/mascot-colors";
import type { MascotCharacter, MascotShape, SkinTier, BUNBU_SKINS, CRAB_SKINS, FROG_SKINS, GRUMP_SKINS, OGRE_SKINS, SHAPE_SKINS, SHIBA_SKINS, TROMBI_SKINS } from "../../../shared/mascot-look";

export const CHARACTER_LABEL = {
  owl: "floatingBots.mascot.owl",
  shape: "floatingBots.mascot.body",
  trombi: "floatingBots.mascot.trombi",
  bunbu: "floatingBots.mascot.bunbu",
  shiba: "floatingBots.mascot.shiba",
  grump: "floatingBots.mascot.grump",
  ogre: "floatingBots.mascot.ogre",
  frog: "floatingBots.mascot.frog",
  crab: "floatingBots.mascot.crab",
} satisfies Record<MascotCharacter, LocaleKey>;

export const SHAPE_LABEL = {
  circle: "mascot.shape.circle",
  bean: "mascot.shape.pebble",
  squircle: "mascot.shape.squircle",
  pill: "mascot.shape.capsule",
  pick: "mascot.shape.triangle",
  hexagon: "mascot.shape.hexagon",
  cloud: "mascot.shape.cloud",
  drop: "mascot.shape.droplet",
  pumpkin: "mascot.shape.pumpkin",
  egg: "mascot.shape.egg",
  gem: "mascot.shape.gem",
  wedge: "mascot.shape.wedge",
  diamond: "mascot.shape.diamond",
  star: "mascot.shape.star",
  clover: "mascot.shape.clover",
  flower: "mascot.shape.flower",
  blossom: "mascot.shape.blossom",
  cat: "mascot.shape.cat",
  ghost: "mascot.shape.ghost",
  jellyfish: "mascot.shape.jellyfish",
  axolotl: "mascot.shape.axolotl",
  puff: "mascot.shape.puff",
  pin: "mascot.shape.pin",
  marker: "mascot.shape.marker",
  sprite: "mascot.shape.sprite",
  flask: "mascot.shape.flask",
  tube: "mascot.shape.tube",
  potion: "mascot.shape.potion",
  chomp: "mascot.shape.chomp",
  nibble: "mascot.shape.nibble",
  shield: "mascot.shape.shield",
  bubble: "mascot.shape.bubble",
  pad: "mascot.shape.pad",
  cup: "mascot.shape.cup",
  bulb: "mascot.shape.bulb",
  say: "mascot.shape.say",
  sprout: "mascot.shape.sprout",
  tin: "mascot.shape.tin",
  tome: "mascot.shape.tome",
  ship: "mascot.shape.ship",
} satisfies Record<MascotShape, LocaleKey>;

export { SHAPE_MOVE_LABEL } from "./moves";

export const SHAPE_SKIN_LABEL = {
  plain: "mascot.shapeSkin.clay",
  pastel: "mascot.shapeSkin.pastel",
  glossy: "mascot.shapeSkin.glossy",
  night: "mascot.shapeSkin.night",
  outline: "mascot.shapeSkin.outline",
  gold: "mascot.shapeSkin.gold",
  neon: "mascot.shapeSkin.neon",
  chrome: "mascot.shapeSkin.chrome",
  crystal: "mascot.shapeSkin.crystal",
  circuit: "mascot.shapeSkin.circuit",
  holo: "mascot.shapeSkin.holo",
  molten: "mascot.shapeSkin.molten",
  galaxy: "mascot.shapeSkin.galaxy",
} satisfies Record<(typeof SHAPE_SKINS)[number], LocaleKey>;

export const TROMBI_SKIN_LABEL = {
  classic: "mascot.trombiSkin.classic",
  retro98: "mascot.trombiSkin.retro98",
  gold: "mascot.trombiSkin.gold",
  neon: "mascot.trombiSkin.neon",
  chrome: "mascot.trombiSkin.chrome",
  glitch: "mascot.trombiSkin.glitch",
  holo: "mascot.trombiSkin.holo",
  molten: "mascot.trombiSkin.molten",
} satisfies Record<(typeof TROMBI_SKINS)[number], LocaleKey>;

export const BUNBU_SKIN_LABEL = {
  plain: "mascot.bunbuSkin.plain",
  pastel: "mascot.bunbuSkin.pastel",
  night: "mascot.bunbuSkin.night",
  plush: "mascot.bunbuSkin.plush",
  velvet: "mascot.bunbuSkin.velvet",
  gold: "mascot.bunbuSkin.gold",
  neon: "mascot.bunbuSkin.neon",
  chrome: "mascot.bunbuSkin.chrome",
  crystal: "mascot.bunbuSkin.crystal",
  holo: "mascot.bunbuSkin.holo",
  galaxy: "mascot.bunbuSkin.galaxy",
  molten: "mascot.bunbuSkin.molten",
} satisfies Record<(typeof BUNBU_SKINS)[number], LocaleKey>;

export const SHIBA_SKIN_LABEL = {
  plain: "mascot.shibaSkin.plain",
  cream: "mascot.shibaSkin.cream",
  blacktan: "mascot.shibaSkin.blacktan",
  red: "mascot.shibaSkin.red",
  sesame: "mascot.shibaSkin.sesame",
  white: "mascot.shibaSkin.white",
  retro98: "mascot.shibaSkin.retro98",
  gold: "mascot.shibaSkin.gold",
  neon: "mascot.shibaSkin.neon",
  chrome: "mascot.shibaSkin.chrome",
  glitch: "mascot.shibaSkin.glitch",
  holo: "mascot.shibaSkin.holo",
  molten: "mascot.shibaSkin.molten",
} satisfies Record<(typeof SHIBA_SKINS)[number], LocaleKey>;

export const GRUMP_SKIN_LABEL = {
  plain: "mascot.grumpSkin.plain",
  tuxedo: "mascot.grumpSkin.tuxedo",
  calico: "mascot.grumpSkin.calico",
  tabby: "mascot.grumpSkin.tabby",
  siamese: "mascot.grumpSkin.siamese",
  retro98: "mascot.grumpSkin.retro98",
  gold: "mascot.grumpSkin.gold",
  void: "mascot.grumpSkin.void",
  neon: "mascot.grumpSkin.neon",
  chrome: "mascot.grumpSkin.chrome",
  glitch: "mascot.grumpSkin.glitch",
  holo: "mascot.grumpSkin.holo",
  molten: "mascot.grumpSkin.molten",
} satisfies Record<(typeof GRUMP_SKINS)[number], LocaleKey>;

export const OGRE_SKIN_LABEL = {
  plain: "mascot.ogreSkin.plain",
  swamp: "mascot.ogreSkin.swamp",
  moss: "mascot.ogreSkin.moss",
  stone: "mascot.ogreSkin.stone",
  lava: "mascot.ogreSkin.lava",
  armor: "mascot.ogreSkin.armor",
  retro98: "mascot.ogreSkin.retro98",
  gold: "mascot.ogreSkin.gold",
  neon: "mascot.ogreSkin.neon",
  chrome: "mascot.ogreSkin.chrome",
  glitch: "mascot.ogreSkin.glitch",
  holo: "mascot.ogreSkin.holo",
  molten: "mascot.ogreSkin.molten",
} satisfies Record<(typeof OGRE_SKINS)[number], LocaleKey>;

export const FROG_SKIN_LABEL = {
  plain: "mascot.frogSkin.plain",
  leaf: "mascot.frogSkin.leaf",
  tree: "mascot.frogSkin.tree",
  poison: "mascot.frogSkin.poison",
  bullfrog: "mascot.frogSkin.bullfrog",
  ghost: "mascot.frogSkin.ghost",
  retro98: "mascot.frogSkin.retro98",
  gold: "mascot.frogSkin.gold",
  neon: "mascot.frogSkin.neon",
  chrome: "mascot.frogSkin.chrome",
  glitch: "mascot.frogSkin.glitch",
  holo: "mascot.frogSkin.holo",
  molten: "mascot.frogSkin.molten",
} satisfies Record<(typeof FROG_SKINS)[number], LocaleKey>;

export const CRAB_SKIN_LABEL = {
  plain: "mascot.crabSkin.plain",
  coral: "mascot.crabSkin.coral",
  sand: "mascot.crabSkin.sand",
  ink: "mascot.crabSkin.ink",
  mint: "mascot.crabSkin.mint",
  gold: "mascot.crabSkin.gold",
  pearl: "mascot.crabSkin.pearl",
  neon: "mascot.crabSkin.neon",
  chrome: "mascot.crabSkin.chrome",
  crystal: "mascot.crabSkin.crystal",
  circuit: "mascot.crabSkin.circuit",
  holo: "mascot.crabSkin.holo",
  molten: "mascot.crabSkin.molten",
  galaxy: "mascot.crabSkin.galaxy",
} satisfies Record<(typeof CRAB_SKINS)[number], LocaleKey>;

export const SKIN_TIER_LABEL = {
  common: "mascot.tier.common",
  rare: "mascot.tier.rare",
  epic: "mascot.tier.epic",
  legendary: "mascot.tier.legendary",
} satisfies Record<SkinTier, LocaleKey>;

export const OWL_SKIN_LABEL = {
  none: "mascot.skin.classic",
  snowy: "mascot.skin.snowy",
  barn: "mascot.skin.barn",
  carbon: "mascot.skin.carbon",
  gold: "mascot.skin.gold",
  frost: "mascot.skin.frost",
  neon: "mascot.skin.neon",
  lightning: "mascot.skin.lightning",
  chrome: "mascot.skin.chrome",
  inferno: "mascot.skin.inferno",
  holo: "mascot.skin.holo",
  galaxy: "mascot.skin.galaxy",
  spirit: "mascot.skin.spirit",
} satisfies Record<MascotSkinId, LocaleKey>;

export const COLOR_GROUP_LABEL = {
  vivid: "mascot.color.group.vivid",
  pastel: "mascot.color.group.pastel",
  deep: "mascot.color.group.deep",
  neon: "mascot.color.group.neon",
  neutral: "mascot.color.group.neutral",
  clay: "mascot.color.group.clay",
} satisfies Record<MascotColorGroup, LocaleKey>;
