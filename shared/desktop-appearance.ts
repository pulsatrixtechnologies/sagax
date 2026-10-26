// The desktop's look, as a personal computer hands it to the paired phone
// (Settings > Appearance > Same as my computer on the iOS companion).
//
// An organization server keeps these keys in the person's preferences
// (shared/user-preferences.ts, /api/me/preferences). A personal computer has
// no person record, so its desktop app keeps a copy of just these appearance keys
// at /api/me/appearance (server/routes/desktop-appearance.ts): the renderer
// writes it from localStorage, the phone reads it, and the phone may write a
// new choice back, which the renderer then applies (src/lib/desktop-appearance-sync.ts).
//
// The id lists repeat src/lib/skins.ts SKIN_IDS and src/lib/fonts.ts
// FONT_IDS (the server does not load renderer modules);
// shared/desktop-appearance.test.ts keeps them equal.

export const DESKTOP_APPEARANCE_PATH = "/api/me/appearance";

export const APPEARANCE_SKIN_IDS = [
  "pulsatrix", "pulsatrix-light", "midnight", "atelier", "foundry", "lagoon",
  "graphite", "linen", "dusk", "daylight", "retro98", "meadow",
] as const;

// The colours and Windows editions laid over a skin (src/lib/skin-families.ts SKIN_TINT_IDS).
export const APPEARANCE_TINT_IDS = [
  "red", "pink", "blue", "green", "yellow",
  "aurore", "ocean", "neon", "foret",
  "cyberpunk", "sunset", "nordic", "candy",
  "xp", "vista", "win7", "win8", "win81", "win10", "win11",
] as const;

// src/lib/skin-families.ts SKIN_TEXTURES, "none" aside (absent = none).
export const APPEARANCE_TEXTURE_IDS = ["grain", "grid", "dots", "lines"] as const;

export const APPEARANCE_FONT_IDS = ["skin", "system", "inter", "poppins", "serif"] as const;

// `omb-skin-mode` ("auto"): the skin follows the system between its
// variant's light and dark skins (src/lib/skin-families.ts). `omb-skin`
// always holds the skin worn now, so an older phone reads it unchanged.
// `omb-skin-tint`: the colour or Windows edition laid over it, absent for the
// family's own look; a phone that does not know it shows the base skin.
// `omb-skin-depth` ("full": the colour reaches every surface) and
// `omb-skin-texture` (a texture over the ground) follow the same way.
export const DESKTOP_APPEARANCE_KEYS = ["omb-skin", "omb-skin-mode", "omb-skin-tint", "omb-skin-depth", "omb-skin-texture", "omb-font", "omb.retro98.on", "omb.retro98.unlocked"] as const;

export type DesktopAppearanceKey = (typeof DESKTOP_APPEARANCE_KEYS)[number];
export type DesktopAppearance = Partial<Record<DesktopAppearanceKey, string>>;

const SKINS: ReadonlySet<string> = new Set(APPEARANCE_SKIN_IDS);
const FONTS: ReadonlySet<string> = new Set(APPEARANCE_FONT_IDS);
const TINTS: ReadonlySet<string> = new Set(APPEARANCE_TINT_IDS);
const TEXTURES: ReadonlySet<string> = new Set(APPEARANCE_TEXTURE_IDS);

function validValue(key: DesktopAppearanceKey, value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (key === "omb-skin") return SKINS.has(value);
  if (key === "omb-font") return FONTS.has(value);
  if (key === "omb-skin-mode") return value === "auto";
  if (key === "omb-skin-tint") return TINTS.has(value);
  if (key === "omb-skin-depth") return value === "full";
  if (key === "omb-skin-texture") return TEXTURES.has(value);
  return value === "1";
}

/** Keep the appearance keys with valid values; drop everything else. */
export function cleanDesktopAppearance(input: unknown): DesktopAppearance {
  const out: DesktopAppearance = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const record = input as Record<string, unknown>;
  for (const key of DESKTOP_APPEARANCE_KEYS) {
    if (validValue(key, record[key])) out[key] = record[key] as string;
  }
  return out;
}

export function sameAppearance(a: DesktopAppearance, b: DesktopAppearance): boolean {
  return DESKTOP_APPEARANCE_KEYS.every((key) => a[key] === b[key]);
}
