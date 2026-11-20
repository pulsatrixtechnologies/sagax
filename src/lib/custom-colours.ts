// The look of a custom colour, duo-tone or mood (M-20261119-073, the owner:
// « custom color picker for Colour, Duo-tone, Mood »), derived from the
// person's colours (custom-tint.ts) the way the swatches' blocks are written
// (styles.css « Colour tints », skin-duo.css, skin-ambiance.css,
// skin-depth.css): the same tokens, on every skin of the three colour
// families, so the picker's miniatures and previews open the same context.
//
// One logic, the app's own: a fill and a text step of the accent as the bot
// colour and the brand do (bot-accent-colors.ts holdContrast and
// color-contrast.ts toneForSurface, hue kept, lightness moved), the text on
// a fill or a gradient from accentInk (bubble-colors.ts) with every stop fitted
// to read at 4.5:1 under it, the person's bubble from bubbleColors, and the
// switch from switchColors following the accent. A mood, and a colour at
// full intensity, lay a palette of the colour's hue with its inks at 4.5:1.
//
// Pure but for `installCustomSheet`; fetched only while a custom tint is
// worn or the picker is open.

import { contrastRatio, relativeLuminance, toneForSurface } from "./color-contrast";
import { accentInk, bubbleColors, bubbleDrift } from "./bubble-colors";
import { holdContrast } from "./bot-accent-colors";
import { fromHsl, switchColors, toHex, toHsl, parseHex as parseRgb } from "./switch-colors";
import { SKIN_GROUNDS, type Grounds } from "./skin-grounds";
import { CUSTOM_DEFAULTS, CUSTOM_KINDS, customKindOf, parseCustomTint, type CustomKind, type CustomTint } from "./custom-tint";

type Scheme = "light" | "dark";
type Tokens = Record<string, string>;

/** WCAG AA, normal text. */
const AA = 4.5;
/** A fill's edge, a focus ring (WCAG 1.4.11). */
const NON_TEXT = 3;

/** The skins a colour, duo-tone or mood is laid over (skin-families.ts colorVariants). */
export const CUSTOM_SKINS = ["pulsatrix", "pulsatrix-light", "midnight", "daylight", "atelier", "foundry"] as const;

/** The stored form; colours in lower case, the angle a whole degree. */
export function formatCustomTint(c: CustomTint): string {
  const h = (v: string) => v.toLowerCase();
  if (c.kind === "custom") return `custom:${h(c.color)}`;
  if (c.kind === "custom-duo") return `custom-duo:${h(c.from)},${h(c.to)},${((Math.round(c.angle) % 360) + 360) % 360}`;
  return `custom-mood:${h(c.ground)},${h(c.from)},${h(c.to)}`;
}

/** The ground of a scheme nearest mid grey: clearing it clears the others (brand.ts brandAccentText). */
function worst(grounds: readonly string[]): string {
  return grounds.reduce((a, b) => (Math.abs(relativeLuminance(a) - 0.18) <= Math.abs(relativeLuminance(b) - 0.18) ? a : b));
}

/** `hex` toned until it reads at `min` on every ground. */
function onEvery(hex: string, grounds: readonly string[], min: number): string {
  let out = hex;
  for (let pass = 0; pass < 3; pass++) {
    const bad = grounds.filter((g) => contrastRatio(out, g) < min);
    if (!bad.length) break;
    out = toneForSurface(out, worst(bad), min + 0.05);
  }
  return out;
}

/**
 * The fill, its ink and the gradient's stops on a skin's grounds: the fill
 * holds 3:1 on the grounds (a button's edge), the ink is accentInk of the
 * fill, and every stop moves away from that ink until it reads at 4.5:1 (a
 * label on a gradient, point 3 of the request).
 */
export function fillOn(stops: readonly string[], grounds: readonly string[]): { ink: string; stops: string[] } {
  const fitted = stops.map((s) => onEvery(s, grounds, NON_TEXT));
  const ink = accentInk(fitted[0]!);
  return { ink, stops: fitted.map((s) => (contrastRatio(s, ink) >= AA ? s : toneForSurface(s, ink, AA + 0.05))) };
}

const at = (h: number, s: number, l: number) => toHex(fromHsl(h, s, Math.min(1, Math.max(0, l))));

/** A palette of a colour's hue for one scheme (a mood's ground, a colour at
 *  full intensity); a ground already of the scheme's lightness is kept. */
export function paletteOf(seed: string, scheme: Scheme, keepSeed = false): { tokens: Tokens; grounds: string[] } {
  const [h, s0, l0] = toHsl(parseRgb(seed) ?? [128, 128, 128]);
  const dark = scheme === "dark";
  const s = Math.min(s0, dark ? 0.42 : 0.38);
  const kept = keepSeed && (dark ? l0 <= 0.13 : l0 >= 0.93);
  const base = kept ? l0 : dark ? 0.07 : 0.965;
  const step = (d: number, sat = s) => at(h, sat, base + (dark ? d : -d));
  const app = kept ? seed.toLowerCase() : step(0);
  const card = dark ? step(0.045) : at(h, s, Math.min(1, base + 0.03));
  const raised = step(0.075);
  const grounds = [app, step(dark ? 0.022 : 0.015), card, raised, step(dark ? 0.015 : 0.025)];
  const ink = onEvery(at(h, Math.min(s0, 0.3), dark ? 0.955 : 0.1), grounds, AA);
  const secondary = onEvery(at(h, Math.min(s0, 0.22), dark ? 0.72 : 0.36), grounds, AA);
  const hairline = step(dark ? 0.14 : 0.13, s * 0.8);
  const border = onEvery(step(dark ? 0.3 : 0.4, s * 0.6), [card, app], NON_TEXT);
  const sidebar = dark ? step(0.012) : step(0.02);
  const tokens: Tokens = {
    "--color-app": app,
    "--color-panel": grounds[1]!,
    "--color-raised": raised,
    "--color-raised-hover": step(0.11),
    "--color-composer": raised,
    "--color-card": card,
    "--color-menu": card,
    "--color-inset": grounds[4]!,
    "--color-control": raised,
    "--color-hairline": hairline,
    "--color-popover-border": border,
    "--color-ink": ink,
    "--color-ink-secondary": secondary,
    "--color-ink-tertiary": secondary,
    "--color-sidebar": sidebar,
    "--color-sidebar-ink": ink,
    "--color-sidebar-ink-secondary": secondary,
    "--color-sidebar-hover": `${ink}0f`,
    "--color-sidebar-hairline": hairline,
    "--color-scrollbar": hairline,
    "--color-maus-line": secondary,
  };
  return { tokens, grounds: [...grounds, sidebar] };
}

/** The tokens a custom tint lays over one skin, in its scheme. */
export function customTokens(skin: string, tint: CustomTint, depth: "accent" | "full" = "accent"): Tokens {
  const base = SKIN_GROUNDS[skin] ?? SKIN_GROUNDS.pulsatrix!;
  const scheme = base.scheme;
  const out: Tokens = {};
  let grounds = base.surfaces;
  let app = base.app;
  let ink = base.ink;
  const seed = tint.kind === "custom-mood" ? tint.ground : tint.kind === "custom" && depth === "full" ? tint.color : null;
  if (seed) {
    const p = paletteOf(seed, scheme, tint.kind === "custom-mood");
    Object.assign(out, p.tokens);
    grounds = p.grounds;
    app = p.tokens["--color-app"]!;
    ink = p.tokens["--color-ink"]!;
  }
  const raw = tint.kind === "custom" ? [tint.color] : [tint.from, tint.to];
  const { ink: label, stops } = fillOn(raw, grounds);
  const [a, b] = stops as [string, string | undefined];
  const strong = scheme === "dark";
  Object.assign(out, {
    "--skin-swatch": a,
    "--color-accent": a,
    "--color-accent-border": a,
    "--color-accent-text": onEvery(holdContrast(a, worst(grounds), AA), grounds, AA),
    "--color-accent-ink": label,
    "--color-focus": a,
    "--color-unread": a,
    "--glyph-ripple-tint": a,
    "--color-sidebar-selected": `${a}${strong ? "29" : "30"}`,
  });
  const glow = (c: string, pct: number, shape: string) => `radial-gradient(${shape}, color-mix(in oklch, ${c} ${pct}%, transparent), transparent 70%)`;
  if (b) {
    const angle = tint.kind === "custom-duo" ? tint.angle : 135;
    out["--accent-from"] = a;
    out["--accent-to"] = b;
    out["--accent-gradient"] = `linear-gradient(${angle}deg, ${a}, ${b})`;
    out["--skin-swatch-image"] = `linear-gradient(135deg, var(--color-app) 0 46%, ${a} 46%, ${b} 100%)`;
    out["--app-glow"] = `${glow(a, strong ? 16 : 9, "ellipse 90% 60% at 18% 0%")}, ${glow(b, strong ? 12 : 7, "ellipse 80% 55% at 85% 0%")}`;
  } else if (seed) {
    out["--app-glow"] = glow(a, strong ? 16 : 8, "ellipse 110% 62% at 50% 0%");
  }
  // The switch follows the accent (point 4).
  const sw = switchColors({ accent: a, ink, surfaces: grounds, scheme, follow: true });
  out["--color-switch-on"] = sw.on;
  out["--color-switch-off"] = sw.off;
  out["--color-switch-on-edge"] = sw.onEdge;
  out["--color-switch-off-edge"] = sw.offEdge;
  // The person's bubble in the accent (bubble-colors.ts), drifting toward a duo-tone's far end.
  const bubbles = bubbleColors({ accent: a, app, scheme, buttonInk: label });
  out["--color-bubble-user"] = `var(--brand-bubble-user, ${bubbles.user})`;
  out["--color-bubble-user-ink"] = `var(--brand-bubble-user-ink, ${bubbles.userInk})`;
  out["--color-bubble-user-well"] = `var(--brand-bubble-user-well, ${bubbles.userWell})`;
  out["--color-bubble-user-to"] = `var(--brand-bubble-user, ${bubbleDrift(bubbles.user, bubbles.userInk, b)})`;
  out["--color-bubble-bot"] = bubbles.bot;
  return out;
}

const decls = (t: Tokens) => Object.entries(t).map(([k, v]) => `  ${k}: ${v};`).join("\n");

/** The sheet of a custom tint: its tokens on every skin of the colour
 *  families (the window, the picker's miniatures and previews), a colour
 *  also at full intensity. `[data-skin]` is named twice, as the bubble
 *  sheet does, so it wins over the skin blocks and their bubbles. */
export function customSheet(tint: string | null): string {
  const custom = parseCustomTint(tint);
  if (!custom) return "";
  const out = [`/* ${custom.kind}, M-20261119-073: src/lib/custom-colours.ts */`];
  for (const skin of CUSTOM_SKINS) {
    const sel = `[data-skin="${skin}"][data-skin="${skin}"][data-skin-tint="${custom.kind}"]`;
    out.push(`${sel} {\n${decls(customTokens(skin, custom))}\n}`);
    if (custom.kind === "custom") out.push(`${sel}[data-skin-depth="full"] {\n${decls(customTokens(skin, custom, "full"))}\n}`);
  }
  return out.join("\n");
}

/** A custom variant: the person picks its colours. */
export function isCustomKind(tint: string | null | undefined): tint is CustomKind {
  return Boolean(tint && (CUSTOM_KINDS as readonly string[]).includes(tint));
}

/** The last colours of each custom row, so a swatch and back keeps them;
 *  it travels with the person (shared/user-preferences.ts). */
export const SKIN_CUSTOM_KEY = "omb-skin-custom";

export function readRememberedCustom(): Partial<Record<CustomKind, string>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SKIN_CUSTOM_KEY) ?? "{}");
    const out: Partial<Record<CustomKind, string>> = {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      const kind = customKindOf(v);
      if (kind) out[kind] = v as string;
    }
    return out;
  } catch {
    return {};
  }
}

export function rememberCustom(tint: string): void {
  const kind = customKindOf(tint);
  if (!kind) return;
  try {
    localStorage.setItem(SKIN_CUSTOM_KEY, JSON.stringify({ ...readRememberedCustom(), [kind]: tint }));
  } catch {
    /* private mode: the colours last this session */
  }
}

/** The colours a custom row opens on: the ones worn, else the row's last, else its first. */
export function customTintFor(kind: CustomKind, worn: string | null | undefined, customs: Partial<Record<CustomKind, string>> = {}): string {
  if (customKindOf(worn) === kind) return worn as string;
  return customs[kind] ?? CUSTOM_DEFAULTS[kind];
}

let adopted: CSSStyleSheet | null = null;

/** Puts the sheet of a custom tint in the document, after every other sheet. */
export function installCustomSheet(tint: string): void {
  const css = customSheet(tint);
  const doc = document;
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in doc) {
    try {
      adopted ??= new CSSStyleSheet();
      adopted.replaceSync(css);
      if (!doc.adoptedStyleSheets.includes(adopted)) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, adopted];
      return;
    } catch {
      /* an engine without constructable sheets: a style element below */
    }
  }
  let el = doc.getElementById("sagax-skin-custom");
  if (!el) {
    el = doc.createElement("style");
    el.id = "sagax-skin-custom";
  }
  el.textContent = css;
  doc.head.appendChild(el);
}

export type { Grounds };
