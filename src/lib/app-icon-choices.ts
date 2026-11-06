// The icons Settings > Appearance > App icon offers: the Pulsatrix logo
// (the default, the bundle's own icon), the Sagax owl, the owl in its skins, a shape, Trombi, Bunbu, Shiba, Grump, Ogre, Frog, the person's Primary Bot, or a picture
// they upload. Pure data: the picker (src/components/settings/AppIconPicker)
// draws each character with the app's own components and paints the result
// through the system template (shared/app-icon-template.ts).
import type { MascotSkinId } from "../../shared/mascot-skins";
import type { BunbuSkin, CrabSkin, FrogSkin, GrumpSkin, MascotShape, OgreSkin, ShapeSkin, ShibaSkin, TrombiSkin } from "../../shared/mascot-look";
import type { MascotColorName } from "../../shared/mascot-colors";
import type { LocaleKey } from "@/locales";
import type { AppIconGlyph } from "./app-icon-glyphs";
import { APP_ICON_TEMPLATES, appIconPlatform, type AppIconTemplate } from "../../shared/app-icon-template";

export type AppIconArt =
  | { kind: "default" }
  /** A finished icon picture the app serves (the former Sagax owl icon). */
  | { kind: "image"; src: string }
  | { kind: "owl"; color: MascotColorName; skin: MascotSkinId }
  | { kind: "shape"; shape: MascotShape; skin: ShapeSkin; color: MascotColorName }
  | { kind: "trombi"; skin: TrombiSkin }
  | { kind: "bunbu"; skin: BunbuSkin; color: MascotColorName }
  | { kind: "shiba"; skin: ShibaSkin; color: MascotColorName }
  | { kind: "grump"; skin: GrumpSkin; color: MascotColorName }
  | { kind: "ogre"; skin: OgreSkin; color: MascotColorName }
  | { kind: "frog"; skin: FrogSkin; color: MascotColorName }
  | { kind: "crab"; skin: CrabSkin; color: MascotColorName }
  | { kind: "glyph"; glyph: AppIconGlyph }
  | { kind: "primary"; botId: string }
  | { kind: "upload" };

export type AppIconChoice = {
  /** Stored by the desktop app; `[a-z0-9:._-]`, at most 64 characters. */
  id: string;
  /** i18n key of the name under the tile (a character or skin name). */
  labelKey: LocaleKey;
  /** The plate behind the character, top to bottom. */
  background: readonly [string, string];
  art: AppIconArt;
  /** How the art sits in the body: a character keeps a margin, a picture fills it. */
  fit: "contain" | "cover";
  /** Turn the art this many degrees (the white Shape leans a little). */
  rotate?: number;
  /** How much of the body the art box takes (default 0.9; the art keeps a margin inside it). */
  fill?: number;
};

/**
 * The default: the bundle's own icon, the Pulsatrix logo on night blue
 * (2026-10-14). Choosing it resets. The id predates the logo and stays,
 * so a saved "sagax" choice still means "the default".
 */
export const DEFAULT_APP_ICON_ID = "sagax";

/** The Sagax owl, the default icon until 2026-10-14, kept as a choice. */
export const SAGAX_OWL_APP_ICON_ID = "sagax-owl";

const owl = (skin: MascotSkinId, color: MascotColorName, background: readonly [string, string]): AppIconChoice => ({
  id: `owl:${skin}`,
  labelKey: `mascot.skin.${skin === "none" ? "classic" : skin}` as LocaleKey,
  background,
  art: { kind: "owl", color, skin },
  fit: "contain",
});

// Finished character pictures (2026-11-06): the app serves each one from public/brand/character-icons.
export const CHARACTER_APP_ICON_IDS = ["block", "droplet", "teardrop", "spiky", "triangle", "sprout", "oblong", "ghost", "blob"] as const;
const CHARACTER_ICON_PREFIX = "character:";
const characterIcon = (name: (typeof CHARACTER_APP_ICON_IDS)[number]): AppIconChoice => ({
  id: `${CHARACTER_ICON_PREFIX}${name}`,
  labelKey: `settings.appIcon.character.${name}` as LocaleKey,
  background: ["#1C1C1E", "#0C0C0D"],
  art: { kind: "image", src: `/brand/character-icons/${name}.png` },
  fit: "cover",
});

export const APP_ICON_CHOICES: readonly AppIconChoice[] = [
  { id: DEFAULT_APP_ICON_ID, labelKey: "settings.appIcon.default", background: ["#0A1A44", "#020818"], art: { kind: "default" }, fit: "cover" },
  { id: SAGAX_OWL_APP_ICON_ID, labelKey: "floatingBots.mascot.owl", background: ["#3A3842", "#3A3842"], art: { kind: "image", src: "/brand/sagax-owl-app-icon.svg" }, fit: "cover" },
  owl("none", "blue", ["#F7F9FC", "#DCE4EF"]),
  owl("snowy", "blue", ["#3C6E9E", "#1B3557"]),
  owl("barn", "orange", ["#F6E7CB", "#DDBB86"]),
  owl("gold", "purple", ["#2D2545", "#120E1E"]),
  owl("frost", "cyan", ["#EAF6FC", "#B5DAEE"]),
  owl("neon", "purple", ["#1C1236", "#05030C"]),
  owl("inferno", "red", ["#40120A", "#110403"]),
  owl("galaxy", "purple", ["#1A1440", "#07051A"]),
  { id: "shape:sparkle", labelKey: "mascot.shape.squircle", background: ["#FDFEFF", "#DCE5F2"], art: { kind: "shape", shape: "squircle", skin: "plain", color: "cobalt" }, fit: "contain" },
  { id: "shape:flower", labelKey: "mascot.shape.cloud", background: ["#FFF5F8", "#F4D2DD"], art: { kind: "shape", shape: "cloud", skin: "pastel", color: "pink" }, fit: "contain" },
  // minimal white glyphs on dark plates
  // the Shapes mascot, whole, on an anthracite plate (the plate is in the glyph)
  { id: "glyph:shape", labelKey: "settings.appIcon.glyph.blob", background: ["#3A3B40", "#1E1F23"], art: { kind: "glyph", glyph: "shape" }, fit: "cover" },
  { id: "glyph:spark", labelKey: "settings.appIcon.glyph.spark", background: ["#22305A", "#0A1024"], art: { kind: "glyph", glyph: "spark" }, fit: "contain" },
  { id: "glyph:cube", labelKey: "settings.appIcon.glyph.cube", background: ["#34353A", "#0E0F11"], art: { kind: "glyph", glyph: "cube" }, fit: "contain" },
  { id: "trombi:classic", labelKey: "floatingBots.mascot.trombi", background: ["#13A0A0", "#006666"], art: { kind: "trombi", skin: "classic" }, fit: "contain" },
  { id: "bunbu:plain", labelKey: "floatingBots.mascot.bunbu", background: ["#FFF6EC", "#F6D9C4"], art: { kind: "bunbu", skin: "plain", color: "mint" }, fit: "contain" },
  { id: "bunbu:holo", labelKey: "mascot.bunbuSkin.holo", background: ["#2A2250", "#0E0A22"], art: { kind: "bunbu", skin: "holo", color: "mint" }, fit: "contain" },
  { id: "shiba:plain", labelKey: "floatingBots.mascot.shiba", background: ["#FFF3E2", "#F5D2AE"], art: { kind: "shiba", skin: "plain", color: "orange" }, fit: "contain" },
  { id: "grump:plain", labelKey: "floatingBots.mascot.grump", background: ["#F6EEDF", "#D9C6A8"], art: { kind: "grump", skin: "plain", color: "brown" }, fit: "contain" },
  { id: "ogre:plain", labelKey: "floatingBots.mascot.ogre", background: ["#F3EBD2", "#C9D79A"], art: { kind: "ogre", skin: "plain", color: "green" }, fit: "contain" },
  { id: "frog:plain", labelKey: "floatingBots.mascot.frog", background: ["#EEF6DC", "#BFDDA0"], art: { kind: "frog", skin: "plain", color: "green" }, fit: "contain" },
  { id: "crab:plain", labelKey: "floatingBots.mascot.crab", background: ["#F8E6DC", "#E8B89A"], art: { kind: "crab", skin: "coral", color: "orange" }, fit: "contain" },
  ...CHARACTER_APP_ICON_IDS.map(characterIcon),
];

/** The choices in the picker's order: the Primary Bot (when there is one) sits before the character pictures. */
export function withPrimaryChoice(primary: { id: string } | null | undefined): AppIconChoice[] {
  const extra = primaryBotChoice(primary);
  if (!extra) return [...APP_ICON_CHOICES];
  const at = APP_ICON_CHOICES.findIndex((choice) => choice.id.startsWith(CHARACTER_ICON_PREFIX));
  return at < 0 ? [...APP_ICON_CHOICES, extra] : [...APP_ICON_CHOICES.slice(0, at), extra, ...APP_ICON_CHOICES.slice(at)];
}

/** The Primary Bot's look, when the person has one. */
export function primaryBotChoice(bot: { id: string } | null | undefined): AppIconChoice | null {
  if (!bot) return null;
  return { id: "primary", labelKey: "primaryBot.badge", background: ["#FFFFFF", "#E6EAF1"], art: { kind: "primary", botId: bot.id }, fit: "contain" };
}

export const UPLOAD_APP_ICON: AppIconChoice = {
  id: "upload",
  labelKey: "settings.appIcon.upload",
  background: ["#FFFFFF", "#FFFFFF"],
  art: { kind: "upload" },
  fit: "cover",
};

/** The template and the PNG sizes the desktop app expects on this platform. */
export function appIconTargets(platform: string): { template: AppIconTemplate; sizes: readonly number[] } {
  const template = APP_ICON_TEMPLATES[appIconPlatform(platform)];
  return { template, sizes: template.sizes };
}

/** The hint under the picker: what the custom icon changes, and what it cannot. */
export function appIconHintKey(platform: string): LocaleKey {
  const kind = appIconPlatform(platform);
  if (kind === "macos") return "settings.appIcon.hintMac";
  if (kind === "windows") return "settings.appIcon.hintWindows";
  return "settings.appIcon.hintLinux";
}
