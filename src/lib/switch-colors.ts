// The colours of a switch (2026-10-28): a switch whose track and thumb were
// both light grey could not be read as on or off, and an accent track with a
// dark thumb read as off. The rules, for every skin, colour, duo-tone and
// mood, light and dark:
//
//   - the thumb is white in both states, never dark;
//   - off is a neutral track, on is the accent;
//   - 3:1 between the thumb and the track, and between the track and every
//     surface a switch sits on (WCAG 1.4.11);
//   - when the accent cannot reach that, its lightness moves (the hue stays);
//     when no lightness can clear both, a contrasting edge draws the track's
//     outline and carries the 3:1 against the surface instead;
//   - the thumb's position, not the colour, says on or off.
//
// Pure: the stylesheet generator (scripts/gen-switch-tokens.mjs), the brand
// accent (brand.ts) and the tests call it; nothing here touches the DOM.

export type Scheme = "light" | "dark";

export interface SwitchColors {
  /** The track when on: the accent at a lightness that carries the white thumb. */
  on: string;
  /** The track when off: a neutral grey. */
  off: string;
  /** The on track's outline, or "transparent" when the track clears 3:1 by itself. */
  onEdge: string;
  /** The off track's outline, or "transparent". */
  offEdge: string;
}

/** The one on colour of every switch in the app (Grok Bot's blue, measured
 * 2026-11-07, #1362c7). The skin's accent, a brand and a bot's colour no longer
 * recolour it, and its lightness never moves per skin. */
export const SWITCH_ON_BLUE = "#1362c7";
/** The off track on a dark skin: Grok Bot's dark track (the panel's #3a3a3a). */
export const SWITCH_OFF_DARK = "#3a3a3a";

/** The thumb, white in both states. */
export const SWITCH_THUMB = "#ffffff";
/** WCAG 1.4.11, non-text contrast. */
export const SWITCH_MIN_CONTRAST = 3;
/** What the derivation aims at: a little over the minimum, so rounding a
 * channel to 8 bits never drops a pair below it. */
const TARGET = 3.1;

type Rgb = [number, number, number];

const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

/** `#rrggbb` (an `#rrggbbaa` alpha is ignored), else null. */
export function parseHex(value: string): Rgb | null {
  const m = HEX.exec(value.trim());
  if (!m) return null;
  const h = m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function lum([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG contrast of two `#rrggbb` colours, 1 to 21 (1 when one cannot be read). */
export function contrastHex(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  return x && y ? ratio(x, y) : 1;
}

export function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/** The colour rounded to 8-bit channels, as it will be written. */
function rounded(c: Rgb): Rgb {
  return c.map((v) => Math.round(Math.min(255, Math.max(0, v)))) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** Every lightness of a hue, 0 to 1, as 8-bit colours. */
function ramp(h: number, s: number): { l: number; rgb: Rgb }[] {
  const out: { l: number; rgb: Rgb }[] = [];
  for (let i = 0; i <= 400; i++) {
    const l = i / 400;
    out.push({ l, rgb: rounded(fromHsl(h, s, l)) });
  }
  return out;
}

const minOver = (c: Rgb, grounds: Rgb[]) => Math.min(...grounds.map((g) => ratio(c, g)));

/** An outline that clears the target on every ground: the track moved toward
 * the ink until it does, else black or white, whichever reads better. */
function edgeFor(track: Rgb, ink: Rgb, grounds: Rgb[]): Rgb {
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    const mixed = rounded([0, 1, 2].map((k) => track[k] * (1 - t) + ink[k] * t) as Rgb);
    if (minOver(mixed, grounds) >= TARGET) return mixed;
  }
  return minOver(BLACK, grounds) >= minOver(WHITE, grounds) ? BLACK : WHITE;
}

/** A track of the hue of `base`: the lightness `pick` prefers among those
 * that carry the white thumb and clear every ground; when none clears the
 * grounds, the one closest to `base` that carries the thumb, with an edge. */
function fitTrack(base: Rgb, ink: Rgb, grounds: Rgb[], pick: "closest" | "lightest" | "darkest", saturation?: number): { track: Rgb; edge: Rgb | null } {
  const [h, s0, l0] = toHsl(base);
  const s = saturation === undefined ? s0 : Math.min(s0, saturation);
  const steps = ramp(h, s);
  const carries = steps.filter(({ rgb }) => ratio(WHITE, rgb) >= TARGET);
  const clears = carries.filter(({ rgb }) => minOver(rgb, grounds) >= TARGET);
  const choose = (list: { l: number; rgb: Rgb }[]) => {
    if (pick === "lightest") return list[list.length - 1];
    if (pick === "darkest") return list[0];
    return list.reduce((best, step) => (Math.abs(step.l - l0) < Math.abs(best.l - l0) ? step : best));
  };
  if (clears.length) {
    // keep the accent itself when it already clears everything
    if (pick === "closest" && ratio(WHITE, base) >= TARGET && minOver(base, grounds) >= TARGET) return { track: rounded(base), edge: null };
    return { track: choose(clears).rgb, edge: null };
  }
  // No lightness clears both the thumb and the grounds (a mid-tone ground):
  // the thumb wins, the edge carries the ground's contrast.
  const track = carries.length ? choose(carries).rgb : BLACK;
  return { track, edge: edgeFor(track, ink, grounds) };
}

/**
 * The switch's colours for an accent on a skin.
 *
 * @param accent   the accent (`#rrggbb`); the on track keeps its hue
 * @param ink      the skin's text colour; the off track takes its tint
 * @param surfaces every opaque surface a switch sits on (`#rrggbb`)
 * @param scheme   light or dark: off is the palest grey on a light skin and
 *                 the deepest one on a dark skin that still clears 3:1
 */
export function switchColors({ accent, ink, surfaces, scheme }: { accent: string; ink: string; surfaces: string[]; scheme: Scheme }): SwitchColors {
  const grounds = surfaces.map(parseHex).filter((c): c is Rgb => c !== null);
  const inkRgb = parseHex(ink) ?? (scheme === "dark" ? WHITE : BLACK);
  void accent; // the accent no longer drives the switch: one on colour, SWITCH_ON_BLUE
  // one value on every skin, light and dark: no lightness search
  const on = { track: parseHex(SWITCH_ON_BLUE) as Rgb, edge: null };
  // a neutral: the ink's own tint, kept faint
  const off = fitTrack(inkRgb, inkRgb, grounds, scheme === "light" ? "lightest" : "darkest", 0.12);
  // dark skins: Grok's dark track, the thumb's position says off
  const dark = scheme === "dark";
  return {
    on: toHex(on.track),
    off: dark ? SWITCH_OFF_DARK : toHex(off.track),
    onEdge: on.edge ? toHex(on.edge) : "transparent",
    offEdge: dark ? "transparent" : off.edge ? toHex(off.edge) : "transparent",
  };
}

/** The contrasts a switch shows, for the tests and the gate: thumb on each
 * track, and each track's outline (its edge, else the track) on the worst ground. */
export function switchContrasts(colors: SwitchColors, surfaces: string[]): { thumbOn: number; thumbOff: number; onGround: number; offGround: number } {
  const ground = (track: string, edge: string) => Math.min(...surfaces.map((s) => contrastHex(edge === "transparent" ? track : edge, s)));
  return {
    thumbOn: contrastHex(SWITCH_THUMB, colors.on),
    thumbOff: contrastHex(SWITCH_THUMB, colors.off),
    onGround: ground(colors.on, colors.onEdge),
    offGround: ground(colors.off, colors.offEdge),
  };
}

/** The custom properties a switch reads, from its colours. */
export function switchVars(colors: SwitchColors): Record<string, string> {
  return {
    "--color-switch-on": colors.on,
    "--color-switch-off": colors.off,
    "--color-switch-on-edge": colors.onEdge,
    "--color-switch-off-edge": colors.offEdge,
  };
}

/**
 * A deployment's brand accent (brand.ts) no longer recolours the switch
 * (2026-11-07): every switch has the one on colour. The properties stay so
 * the callers keep working; they are empty.
 */
export const BRAND_SURFACES: Record<Scheme, string[]> = {
  light: ["#ffffff", "#dcdcdc"],
  dark: ["#000000", "#2e2e2e"],
};

/** The names of the brand's switch properties, set or removed together. */
export const BRAND_SWITCH_VARS = ["--brand-switch-on-light", "--brand-switch-on-edge-light", "--brand-switch-on-dark", "--brand-switch-on-edge-dark"] as const;

/** The brand's on track per scheme, as custom properties (empty for a colour that is not `#rrggbb`). */
export function brandSwitchVars(accent: string | undefined): Record<string, string> {
  void accent;
  return {};
}

/**
 * A bot's colour as the switch track inside its own panel (2026-10-28).
 * Some skins have a neutral accent (Studio), so an on switch read grey; in a
 * bot's panel and its screens (routines, the bot's settings, tasks) the on
 * track takes the bot's colour instead, whatever the "Use bot color as
 * accent" setting says. Same rule as the brand accent: the lightness moves
 * until the track holds 3:1 with the white thumb and with the extremes of
 * every skin's surfaces, the hue stays, an edge is added when none does.
 * App.tsx puts these on <body> with `data-bot-switch`; the generated
 * stylesheet picks the scheme's pair (skin-switch.css).
 */
/** The brand's extremes, widened to Hibou 98's silver (#c0c0c0): the bot's track is also derived for that skin. */
export const BOT_SURFACES: Record<Scheme, string[]> = { light: ["#ffffff", "#c0c0c0"], dark: BRAND_SURFACES.dark };

export const BOT_SWITCH_VARS = ["--bot-switch-on-light", "--bot-switch-on-edge-light", "--bot-switch-on-dark", "--bot-switch-on-edge-dark"] as const;

/** The bot's on track per scheme, as custom properties (empty for a colour that is not `#rrggbb`). */
export function botSwitchVars(color: string | null | undefined): Record<string, string> {
  void color;
  return {};
}
