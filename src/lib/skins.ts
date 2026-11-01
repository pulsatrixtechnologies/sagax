// Skins are pure CSS. Every one of them is a block of custom properties in
// styles.css, selected by a `data-skin` attribute; this module only decides
// which one is active and remembers the choice. Nothing here knows a colour —
// that keeps the two halves from drifting apart, and it means adding a skin is
// one CSS block plus one line in SKINS.

import { autoPairs, isSkinDepth, isSkinTexture, isSkinTint, LEGACY_SKINS, normalizeWorn, readSkinAuto, writeSkinAuto, type SkinDepth, type SkinTexture, type SkinTintId } from "./skin-families";
import { SKIN_IDS, type SkinId } from "./skin-ids";

export { SKIN_IDS, type SkinId };

export type Skin = {
  id: SkinId;
  name: string;
  /** One line, shown under the name in the picker. */
  tagline: string;
  /** A secret skin: the picker lists it only once this device has unlocked it. */
  secret?: boolean;
};

export const SKINS: readonly Skin[] = [
  { id: "pulsatrix", name: "Pulsatrix", tagline: "Pulsatrix blue. Deep navy with a soft glow from the top." },
  { id: "pulsatrix-light", name: "Pulsatrix Light", tagline: "Pulsatrix blue on a bright ice ground, with the same soft glow from the top." },
  { id: "midnight", name: "Midnight", tagline: "The original. Cool and dark." },
  { id: "atelier", name: "Atelier", tagline: "Daylight on paper, warm and quiet." },
  { id: "foundry", name: "Foundry", tagline: "Night shift. Dark, warm, lit in brass." },
  { id: "lagoon", name: "Lagoon", tagline: "Cool daylight. Porcelain and deep teal." },
  { id: "graphite", name: "Graphite", tagline: "Quiet charcoal and softened steel blue." },
  { id: "linen", name: "Linen", tagline: "Clean daylight with a restrained navy accent." },
  { id: "dusk", name: "Dusk", tagline: "Muted plum after dark, calm and low-key." },
  { id: "daylight", name: "Daylight", tagline: "Midnight in reverse. Near-white, ink-black bubbles." },
  { id: "retro98", name: "Hibou 98", tagline: "Bevelled grey windows on a teal desktop, straight out of the late 90s.", secret: true },
  { id: "meadow", name: "Meadow", tagline: "Fresh white with a calm green." },
];

/** The skins the picker shows: every public one, plus the secret ones this device unlocked. */
export function visibleSkins(unlocked: boolean, active?: SkinId): readonly Skin[] {
  return SKINS.filter((skin) => !skin.secret || unlocked || skin.id === active);
}

export const DEFAULT_SKIN: SkinId = "pulsatrix";

const KEY = "omb-skin";
/** The colour (or Windows edition) laid over the worn skin; absent for the family's own look. */
export const SKIN_TINT_KEY = "omb-skin-tint";
/** How far a colour reaches: absent for the accent only, "full" for the whole surface. */
export const SKIN_DEPTH_KEY = "omb-skin-depth";
/** A texture over the ground: absent for none. */
export const SKIN_TEXTURE_KEY = "omb-skin-texture";

// The input is whatever localStorage handed back — a string this app wrote
// on an earlier run, a value edited by hand, or a leftover from a renamed
// skin. The list is the schema.
function isSkinId(value: unknown): value is SkinId {
  // SAFETY: the assertion only satisfies includes()' parameter type; the
  // check itself is what decides, and a non-member returns false.
  return SKIN_IDS.includes(value as SkinId);
}

// Reaching for localStorage is itself a failure point: on an origin with
// storage blocked the getter throws, and `typeof` alone doesn't shield it.
function getStore(): Storage | undefined {
  try {
    // A bare feature test, not a narrowing of parsed input: in a renderer
    // without storage the identifier is simply not defined.
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The system's scheme (Auto follows it); light when it cannot be read. */
export function prefersDarkScheme(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  } catch {
    return false;
  }
}

/** The stored skin as worn: under Auto (skin-families.ts), the stored
 * variant's light or dark skin for the system's scheme now. */
export function resolveStoredSkin(stored: string | null | undefined, auto: boolean, prefersDark: boolean): SkinId {
  const raw = isSkinId(stored) ? stored : DEFAULT_SKIN;
  // a skin no variant lists any more is worn as its mapped base (its colour comes from readSkinTint)
  const skin = LEGACY_SKINS[raw]?.skin ?? raw;
  if (!auto) return skin;
  const pair = autoPairs()[skin];
  return pair ? pair[prefersDark ? 1 : 0] : skin;
}

/** The stored tint, or null; a legacy skin still stored brings its mapped colour. */
export function readSkinTint(): SkinTintId | null {
  try {
    const store = getStore();
    const stored = store?.getItem(KEY);
    const legacy = isSkinId(stored) ? LEGACY_SKINS[stored] : undefined;
    if (legacy) return legacy.tint;
    const tint = store?.getItem(SKIN_TINT_KEY);
    return isSkinTint(tint) ? tint : null;
  } catch {
    return null;
  }
}

export function readSkinDepth(): SkinDepth {
  try {
    const value = getStore()?.getItem(SKIN_DEPTH_KEY);
    return isSkinDepth(value) ? value : "accent";
  } catch {
    return "accent";
  }
}

export function readSkinTexture(): SkinTexture {
  try {
    const value = getStore()?.getItem(SKIN_TEXTURE_KEY);
    return isSkinTexture(value) ? value : "none";
  } catch {
    return "none";
  }
}

/** Stamp a stored choice on the document, and remember it (absent = the default). */
function stampChoice(attribute: "skinDepth" | "skinTexture", key: string, value: string, fallback: string): void {
  const root = document.documentElement;
  if (value === fallback) delete root.dataset[attribute];
  else root.dataset[attribute] = value;
  try {
    if (value === fallback) getStore()?.removeItem(key);
    else getStore()?.setItem(key, value);
  } catch {
    /* private mode: the choice lasts this session */
  }
}

/** How far a colour reaches: the accent only, or the whole surface (skin-depth.css). */
export function applySkinDepth(depth: SkinDepth): void {
  stampChoice("skinDepth", SKIN_DEPTH_KEY, depth, "accent");
}

/** A light texture over the ground (skin-texture.css). */
export function applySkinTexture(texture: SkinTexture): void {
  stampChoice("skinTexture", SKIN_TEXTURE_KEY, texture, "none");
}

export function readSkin(): SkinId {
  try {
    return resolveStoredSkin(getStore()?.getItem(KEY), readSkinAuto(getStore()), prefersDarkScheme());
  } catch {
    return DEFAULT_SKIN;
  }
}

/**
 * Wear a skin chosen in the picker: the skin itself, and whether it follows
 * the system (Auto). A skin with no light and dark pair cannot follow it.
 */
export function chooseSkin(id: SkinId, auto: boolean, tint: SkinTintId | null = null): void {
  writeSkinAuto(auto && Boolean(autoPairs()[id]), getStore());
  applySkin(id, tint);
}

/** Under Auto, the system switching between light and dark switches the
 * variant's skin, live. Installed once by main.tsx; returns the remover. */
export function installSkinAutoFollow(): () => void {
  let query: MediaQueryList | undefined;
  try {
    query = typeof window === "undefined" ? undefined : window.matchMedia?.("(prefers-color-scheme: dark)");
  } catch {
    query = undefined;
  }
  if (!query) return () => undefined;
  const follow = () => {
    if (!readSkinAuto(getStore())) return;
    const worn = document.documentElement.dataset.skin;
    const next = resolveStoredSkin(worn, true, query?.matches === true);
    if (next !== worn) applySkin(next);
  };
  query.addEventListener?.("change", follow);
  return () => query?.removeEventListener?.("change", follow);
}

/**
 * Point the document at a skin and remember it. Called once before the first
 * paint (main.tsx) and again on every change from the picker — a stamped
 * attribute rather than a class so it can never collide with Tailwind.
 */
export function applySkin(requested: SkinId, requestedTint?: SkinTintId | null): void {
  // `undefined` keeps the tint worn now when the skin's family has it (Auto
  // swapping light and dark, a gallery page re-applying the stored skin);
  // null clears it. A legacy skin is worn as its mapped base and colour.
  const keep = requestedTint === undefined ? readSkinTint() : requestedTint;
  const { skin: id, tint } = normalizeWorn(requested, keep);
  // A structural skin brings a stylesheet layer that tokens cannot express.
  // It is fetched only when that skin is worn, and every rule in it is scoped
  // to the skin, so it stays inert after switching away. The colour tints are
  // small and always loaded; the Windows editions' chrome comes with Hibou 98.
  if (id === "retro98") {
    void import("../styles/retro98.css").catch(() => undefined);
    // every edition, not only the worn one: the picker's swatches read their colours
    void import("../styles/retro-editions.css").catch(() => undefined);
  }
  const root = document.documentElement;
  root.dataset.skin = id;
  if (tint) root.dataset.skinTint = tint;
  else delete root.dataset.skinTint;
  try {
    getStore()?.setItem(KEY, id);
    if (tint) getStore()?.setItem(SKIN_TINT_KEY, tint);
    else getStore()?.removeItem(SKIN_TINT_KEY);
  } catch {
    /* quota / private mode — the skin still applies for this session */
  }
  // The one surface CSS cannot reach: on Windows the caption buttons sit in a
  // native overlay the main process paints. Left at the default it stays
  // Midnight-black on a light skin — the "black block in the top-right
  // corner" of issue #454. Best-effort: a browser tab or an older desktop
  // build has no bridge, and the skin still applies without it.
  try {
    void window.ogb?.applySkin?.(id)?.catch(() => undefined);
  } catch {
    /* no bridge */
  }
}
