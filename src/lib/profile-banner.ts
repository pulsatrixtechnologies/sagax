// The bot profile banner's two colours (top, bottom): the accent washed into
// a pale base, as the page always drew it, then kept apart from the mascot
// that sits on its lower edge. The wash comes from the bot colour and the
// mascot wears the same colour (or a skin near it), so the two can land on
// almost the same tone and the mascot disappears. When the contrast between
// the mascot's body colour and the band is under 2:1, the band's lightness
// moves away from the mascot, by just enough to reach the target, with its
// hue and saturation kept. The iOS page does the same
// (ios/Sources/CompanionCore/ProfileBanner.swift).
import { contrast, normalizeHex } from "./bot-accent-colors";

/** The wash's pale base: one plain colour, never light-dark() (#2554). */
export const BANNER_BASE = "#f7f7f7";
/** The accent's share of the wash: at the top (stronger) and the bottom. */
export const BANNER_TOP_SHARE = 0.58;
export const BANNER_BOTTOM_SHARE = 0.36;
/** Below this the mascot reads poorly on the band; the band moves. */
export const BANNER_MIN_CONTRAST = 2;
/** What a moved band reaches, a little above the minimum. */
export const BANNER_TARGET_CONTRAST = 2.2;

type Rgb = [number, number, number];
type Hsl = [number, number, number];

const channels = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: Rgb): string => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** `accent` taking `share` of the wash, the rest the base (sRGB, as color-mix). */
function wash(accent: string, share: number): string {
  const a = channels(accent);
  const b = channels(BANNER_BASE);
  return toHex(a.map((c, i) => c * share + b[i]! * (1 - share)) as Rgb);
}

function toHsl(hex: string): Hsl {
  const [r, g, b] = channels(hex).map((c) => c / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: Hsl): string {
  const hue = (p: number, q: number, t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  if (s === 0) return toHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return toHex([hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]);
}

/**
 * How far to move the lightness (a signed step) so `band` holds the target
 * against `mascot`, the shortest way either side; null when neither side gets there.
 */
function lightnessShift(band: string, mascot: string): number | null {
  const [h, s, l] = toHsl(band);
  const STEP = 0.005;
  const reach = (direction: 1 | -1): number | null => {
    for (let shift = STEP; l + direction * shift >= -STEP && l + direction * shift <= 1 + STEP; shift += STEP) {
      const next = Math.min(1, Math.max(0, l + direction * shift));
      if (contrast(fromHsl([h, s, next]), mascot) >= BANNER_TARGET_CONTRAST) return next - l;
    }
    return null;
  };
  const lighter = reach(1);
  const darker = reach(-1);
  if (lighter === null || darker === null) return lighter ?? darker;
  return Math.abs(darker) < Math.abs(lighter) ? darker : lighter;
}

/**
 * The banner's top and bottom colours for `accent`, kept apart from the
 * mascot's body colour `mascot` (null: a picture, nothing to keep apart from).
 */
export function profileBannerColors(accent: string, mascot: string | null): { from: string; to: string } {
  const base = normalizeHex(accent) ?? "#8e949e";
  const from = wash(base, BANNER_TOP_SHARE);
  const to = wash(base, BANNER_BOTTOM_SHARE);
  const body = normalizeHex(mascot);
  if (!body || contrast(to, body) >= BANNER_MIN_CONTRAST) return { from, to };
  const shift = lightnessShift(to, body);
  if (shift === null) return { from, to };
  const move = (hex: string): string => {
    const [h, s, l] = toHsl(hex);
    return fromHsl([h, s, Math.min(1, Math.max(0, l + shift))]);
  };
  return { from: move(from), to: move(to) };
}
