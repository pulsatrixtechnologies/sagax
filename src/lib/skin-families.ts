// Skin families (2026-10-19): "chaque skin devrait avoir ses propres
// variantes au lieu d'avoir des skins très proches visuellement". The twelve
// skins of src/lib/skins.ts are grouped into a few families, each with its
// own identity (type, radii, how the rail and the bubbles are drawn); the
// skins that only differed by a tint or by light and dark are the variants
// of one family.
//
// Nothing about a skin's look moved: a variant in a mode IS one of the old
// skins, and `omb-skin` still holds that concrete id (the CSS block, the
// Windows caption overlay, the phone's "Same as my computer" and every older
// build read it unchanged). The one new choice is Auto, kept beside it in
// `omb-skin-mode` ("auto"): the variant's light or dark skin, following the
// system. A family, a variant and a mode are therefore always derived from
// the worn skin, so every saved choice, old or new, maps to itself.
//
// Colour variants (2026-10-19): « des variantes pour chacun : la couleur de
// base, rouge, rose, bleu, vert, jaune ; pour Hibou 98, Windows XP, Vista, 7,
// 8, 8.1, 10 et 11 ». A variant is now a base skin plus an optional TINT:
// `data-skin` keeps the base skin's id (so the Windows caption overlay, the
// phone and every older build read it unchanged) and `data-skin-tint` lays the
// colour over it (src/styles/skin-tints.css), or, under Hibou 98, the chrome of
// one Windows edition (src/styles/retro-editions.css). The tint is stored apart
// in `omb-skin-tint` (skins.ts). The near-duplicate skins this replaces (Slate,
// Plum, Meadow, Lagoon) stay worn by older builds; this one maps them to the
// closest base and colour (LEGACY_SKINS), so nobody loses their choice.
import type { SkinId } from "./skin-ids";

export type SkinScheme = "light" | "dark";
/** What the person picked: one scheme, or Auto (follow the system). */
export type SkinModeChoice = SkinScheme | "auto";

export const SKIN_FAMILY_IDS = ["pulsatrix", "studio", "atelier", "retro98"] as const;
export type SkinFamilyId = (typeof SKIN_FAMILY_IDS)[number];

/** The colours laid over the Pulsatrix, Studio and Atelier families. */
export const SKIN_COLOR_TINTS = ["red", "pink", "blue", "green", "yellow"] as const;
/** Two-colour gradients over the same families (2026-10-19: « des variantes plus complexes »). */
export const SKIN_DUO_TINTS = ["aurore", "ocean", "neon", "foret"] as const;
/** Themed moods: a whole palette, its gradients and its own glow over the family's shapes. */
export const SKIN_AMBIANCE_TINTS = ["cyberpunk", "sunset", "nordic", "candy"] as const;
/** The Windows editions laid over Hibou 98 (its own 98 look is the Classic variant). */
export const SKIN_WINDOWS_TINTS = ["xp", "vista", "win7", "win8", "win81", "win10", "win11"] as const;
export const SKIN_TINT_IDS = [...SKIN_COLOR_TINTS, ...SKIN_DUO_TINTS, ...SKIN_AMBIANCE_TINTS, ...SKIN_WINDOWS_TINTS] as const;

/** The swatch rows of the picker: the family's own look and its colours, the duo-tones, the moods, Windows editions. */
export type SkinVariantGroup = "color" | "duo" | "ambiance" | "edition";

/**
 * How far a colour reaches (`data-skin-depth`, `omb-skin-depth`): the accent
 * only, or the whole surface (ground, sidebar, cards, bubbles, glow). Only the
 * colour variants have it; the moods already colour everything.
 */
export const SKIN_DEPTHS = ["accent", "full"] as const;
export type SkinDepth = (typeof SKIN_DEPTHS)[number];

/** A light texture over the ground (`data-skin-texture`, `omb-skin-texture`), any variant, any family but Hibou 98. */
export const SKIN_TEXTURES = ["none", "grain", "grid", "dots", "lines"] as const;
export type SkinTexture = (typeof SKIN_TEXTURES)[number];

export function isSkinDepth(value: unknown): value is SkinDepth {
  return typeof value === "string" && (SKIN_DEPTHS as readonly string[]).includes(value);
}

export function isSkinTexture(value: unknown): value is SkinTexture {
  return typeof value === "string" && (SKIN_TEXTURES as readonly string[]).includes(value);
}
export type SkinTintId = (typeof SKIN_TINT_IDS)[number];

export const SKIN_VARIANT_IDS = ["basic", "classic", ...SKIN_TINT_IDS] as const;
export type SkinVariantId = (typeof SKIN_VARIANT_IDS)[number];

export function isSkinTint(value: unknown): value is SkinTintId {
  return typeof value === "string" && (SKIN_TINT_IDS as readonly string[]).includes(value);
}

export type SkinVariant = {
  id: SkinVariantId;
  /** The skin worn in a light mode, when the variant has one. */
  light?: SkinId;
  /** The skin worn in a dark mode, when the variant has one. */
  dark?: SkinId;
  /** Laid over the skin as `data-skin-tint`; absent on the family's own look. */
  tint?: SkinTintId;
  /** The picker row it sits in. */
  group: SkinVariantGroup;
};

/**
 * The family's own look first, then one variant per colour, per duo-tone and
 * per mood over the same light and dark skins. Cyberpunk is a night mood and
 * Candy a daylight one, so each has the one scheme.
 */
function colorVariants(light: SkinId, dark: SkinId, skip: readonly SkinTintId[] = []): SkinVariant[] {
  const both = (tint: SkinTintId, group: SkinVariantGroup): SkinVariant => ({ id: tint, light, dark, tint, group });
  return [
    { id: "basic", light, dark, group: "color" },
    ...SKIN_COLOR_TINTS.filter((tint) => !skip.includes(tint)).map((tint) => both(tint, "color")),
    ...SKIN_DUO_TINTS.map((tint) => both(tint, "duo")),
    { id: "cyberpunk", dark, tint: "cyberpunk", group: "ambiance" },
    both("sunset", "ambiance"),
    both("nordic", "ambiance"),
    { id: "candy", light, tint: "candy", group: "ambiance" },
  ];
}

export type SkinFamily = {
  id: SkinFamilyId;
  name: string;
  variants: readonly SkinVariant[];
  /** A secret family: the picker lists it once this device has unlocked it. */
  secret?: boolean;
};

export const SKIN_FAMILIES: readonly SkinFamily[] = [
  // Perspicax's own look: Geist, navy chrome, the soft glow from the top. Its
  // own colour is already blue, so it has no separate Blue variant.
  { id: "pulsatrix", name: "Pulsatrix", variants: colorVariants("pulsatrix-light", "pulsatrix", ["blue"]) },
  // The reference design's flat neutral look: Inter, monochrome buttons, inverted bubbles in light.
  { id: "studio", name: "Studio", variants: colorVariants("daylight", "midnight") },
  // Paper: a tinted ground where surfaces get brighter as they rise.
  { id: "atelier", name: "Atelier", variants: colorVariants("atelier", "foundry") },
  // Bevelled late-90s windows and classic scrollbars; each later edition of
  // Windows lays its own chrome over the same skin.
  {
    id: "retro98",
    name: "Hibou 98",
    secret: true,
    variants: [
      { id: "classic", light: "retro98", group: "edition" },
      ...SKIN_WINDOWS_TINTS.map((tint) => ({ id: tint, light: "retro98" as SkinId, tint, group: "edition" as const })),
    ],
  },
];

/**
 * The skins older builds may still wear that no variant lists any more: each
 * is worn as the closest base skin and colour. Their CSS blocks stay, so a
 * build before the colour variants keeps drawing them.
 */
export const LEGACY_SKINS: Partial<Record<SkinId, { skin: SkinId; tint: SkinTintId }>> = {
  graphite: { skin: "midnight", tint: "blue" },
  linen: { skin: "daylight", tint: "blue" },
  dusk: { skin: "midnight", tint: "pink" },
  meadow: { skin: "daylight", tint: "green" },
  lagoon: { skin: "atelier", tint: "blue" },
};

/** A worn skin and its tint, with a legacy skin mapped and a tint its family has no variant for dropped. */
export function normalizeWorn(skin: SkinId, tint: SkinTintId | null | undefined): { skin: SkinId; tint: SkinTintId | null } {
  const legacy = LEGACY_SKINS[skin];
  if (legacy) return { ...legacy };
  if (!tint) return { skin, tint: null };
  return PLACES.has(placeKey(skin, tint)) ? { skin, tint } : { skin, tint: null };
}

export type SkinPlace = { family: SkinFamily; variant: SkinVariant; scheme: SkinScheme };

function placeKey(skin: SkinId, tint: SkinTintId | null | undefined): string {
  return `${skin}|${tint ?? ""}`;
}

const PLACES: ReadonlyMap<string, SkinPlace> = (() => {
  const map = new Map<string, SkinPlace>();
  for (const family of SKIN_FAMILIES) {
    for (const variant of family.variants) {
      if (variant.light) map.set(placeKey(variant.light, variant.tint), { family, variant, scheme: "light" });
      if (variant.dark) map.set(placeKey(variant.dark, variant.tint), { family, variant, scheme: "dark" });
    }
  }
  return map;
})();

/**
 * Where a worn skin and tint sit: the family, the variant and the scheme. A
 * legacy skin sits at its mapped colour; a tint the family lacks is ignored.
 */
export function placeOfSkin(skin: SkinId, tint?: SkinTintId | null): SkinPlace {
  const worn = normalizeWorn(skin, tint);
  const place = PLACES.get(placeKey(worn.skin, worn.tint));
  // Every SKIN_IDS entry is a base or a legacy skin (skin-families.test.ts); a missing one is a programming error.
  if (!place) throw new Error(`skin ${skin} belongs to no family`);
  return place;
}

/** Every base skin a family wears (checked by the tests against SKIN_IDS and LEGACY_SKINS). */
export function familySkins(): SkinId[] {
  const out = new Set<SkinId>();
  for (const family of SKIN_FAMILIES) {
    for (const variant of family.variants) {
      if (variant.light) out.add(variant.light);
      if (variant.dark) out.add(variant.dark);
    }
  }
  return [...out];
}

/**
 * The appearance of every base skin: the scheme its CSS block draws
 * (`--code-color-scheme` in styles.css, checked by the tests). The picker
 * files a variant under a scheme only through this, so a skin tagged wrong
 * would leak a light mood into the dark list.
 */
export const SKIN_SCHEMES: Record<SkinId, SkinScheme> = {
  pulsatrix: "dark",
  "pulsatrix-light": "light",
  midnight: "dark",
  atelier: "light",
  foundry: "dark",
  lagoon: "light",
  graphite: "dark",
  linen: "light",
  dusk: "dark",
  daylight: "light",
  retro98: "light",
  meadow: "light",
};

/**
 * The variants the picker offers for the scheme worn now: those with a skin in
 * that scheme (Cyberpunk is dark only, Candy and the Windows editions light
 * only), so dark mode never lists a light mood and light mode never a dark
 * one. A variant with both is listed once and shows the skin of the scheme.
 * `keep` is the variant worn now, always listed so the selection never
 * disappears (a stored choice from a build that allowed the other scheme).
 */
export function variantsForScheme(family: SkinFamily, scheme: SkinScheme, keep?: SkinVariant): SkinVariant[] {
  return family.variants.filter((variant) => variant === keep || (scheme === "light" ? variant.light : variant.dark) !== undefined);
}

export function schemesOf(variant: SkinVariant): SkinScheme[] {
  const out: SkinScheme[] = [];
  if (variant.light) out.push("light");
  if (variant.dark) out.push("dark");
  return out;
}

/** True when the variant has both a light and a dark skin, so Auto can follow the system. */
export function canFollowSystem(variant: SkinVariant): boolean {
  return Boolean(variant.light && variant.dark);
}

/** The variant's skin for a scheme, or the one scheme it has. */
export function variantSkin(variant: SkinVariant, scheme: SkinScheme): SkinId {
  const wanted = scheme === "light" ? variant.light : variant.dark;
  // SAFETY: every variant declares at least one of the two (skin-families.test.ts).
  return (wanted ?? variant.light ?? variant.dark) as SkinId;
}

export function findFamily(id: string): SkinFamily | undefined {
  return SKIN_FAMILIES.find((family) => family.id === id);
}

export function findVariant(family: SkinFamily, id: string): SkinVariant | undefined {
  return family.variants.find((variant) => variant.id === id);
}

/** The families the picker shows: every public one, plus a secret one unlocked here or worn now. */
export function visibleFamilies(unlocked: boolean, active?: SkinFamilyId): readonly SkinFamily[] {
  return SKIN_FAMILIES.filter((family) => !family.secret || unlocked || family.id === active);
}

/**
 * The skin to wear for a choice. `prefersDark` is the system's scheme, read
 * only for Auto. A mode the variant lacks falls to the one it has (Plum is
 * dark only, Meadow light only), and Auto on such a variant is that skin.
 */
export function resolveSkin(variant: SkinVariant, mode: SkinModeChoice, prefersDark: boolean): SkinId {
  const scheme: SkinScheme = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
  return variantSkin(variant, scheme);
}

/**
 * The variant a family opens on when it is picked from the grid: the variant
 * remembered for it (the person's last one there), else its first variant
 * that has the scheme worn now, else its first.
 */
export function defaultVariant(family: SkinFamily, scheme: SkinScheme, remembered?: string | null): SkinVariant {
  const kept = remembered ? findVariant(family, remembered) : undefined;
  if (kept) return kept;
  return family.variants.find((variant) => (scheme === "light" ? variant.light : variant.dark)) ?? family.variants[0];
}

/** The mode a new variant keeps: Auto while the variant can follow the system, else the scheme it can show. */
export function carryMode(variant: SkinVariant, mode: SkinModeChoice, scheme: SkinScheme): SkinModeChoice {
  if (mode === "auto") return canFollowSystem(variant) ? "auto" : schemesOf(variant)[0];
  const schemes = schemesOf(variant);
  return schemes.includes(mode) ? mode : schemes.includes(scheme) ? scheme : schemes[0];
}

// ── Stored choice ────────────────────────────────────────────────────────
// `omb-skin` (skins.ts) is the worn skin; these two keys add what a single id
// cannot say: Auto, and the last variant picked in each family.

export const SKIN_MODE_KEY = "omb-skin-mode";
export const SKIN_VARIANTS_KEY = "omb-skin-variants";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** True when the person chose Auto. Anything else (absent, an old build's value) is a fixed skin. */
export function readSkinAuto(storage: Store | undefined = store()): boolean {
  try {
    return storage?.getItem(SKIN_MODE_KEY) === "auto";
  } catch {
    return false;
  }
}

export function writeSkinAuto(auto: boolean, storage: Store | undefined = store()): void {
  try {
    if (auto) storage?.setItem(SKIN_MODE_KEY, "auto");
    else storage?.removeItem(SKIN_MODE_KEY);
  } catch {
    /* private mode: the choice lasts this session */
  }
}

/** The last variant picked per family, as stored (bad JSON or values are ignored). */
export function readRememberedVariants(storage: Store | undefined = store()): Partial<Record<SkinFamilyId, SkinVariantId>> {
  try {
    const raw = storage?.getItem(SKIN_VARIANTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Partial<Record<SkinFamilyId, SkinVariantId>> = {};
    for (const family of SKIN_FAMILIES) {
      const value = (parsed as Record<string, unknown>)[family.id];
      if (typeof value === "string" && findVariant(family, value)) out[family.id] = value as SkinVariantId;
    }
    return out;
  } catch {
    return {};
  }
}

export function rememberVariant(family: SkinFamilyId, variant: SkinVariantId, storage: Store | undefined = store()): void {
  const next = { ...readRememberedVariants(storage), [family]: variant };
  try {
    storage?.setItem(SKIN_VARIANTS_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

/** The light and dark skin of every variant that has both: the first-paint script resolves Auto with it. */
export function autoPairs(): Record<string, [SkinId, SkinId]> {
  const out: Record<string, [SkinId, SkinId]> = {};
  for (const family of SKIN_FAMILIES) {
    for (const variant of family.variants) {
      if (variant.light && variant.dark) {
        out[variant.light] = [variant.light, variant.dark];
        out[variant.dark] = [variant.light, variant.dark];
      }
    }
  }
  return out;
}

/** The tints each base skin can wear: the first-paint script drops any other stored tint. */
export function tintsBySkin(): Record<string, SkinTintId[]> {
  const out: Record<string, SkinTintId[]> = {};
  for (const family of SKIN_FAMILIES) {
    for (const variant of family.variants) {
      if (!variant.tint) continue;
      for (const skin of [variant.light, variant.dark]) {
        if (!skin) continue;
        const list = (out[skin] ??= []);
        if (!list.includes(variant.tint)) list.push(variant.tint);
      }
    }
  }
  return out;
}

/** LEGACY_SKINS as [base, tint] pairs, for the first-paint script. */
export function legacyPairs(): Record<string, [SkinId, SkinTintId]> {
  const out: Record<string, [SkinId, SkinTintId]> = {};
  for (const [skin, mapped] of Object.entries(LEGACY_SKINS)) if (mapped) out[skin] = [mapped.skin, mapped.tint];
  return out;
}
