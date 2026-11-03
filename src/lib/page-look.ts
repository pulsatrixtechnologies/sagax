// The look of a published page's reader (2026-10-29): "le bandeau du haut
// devrait suivre le thème de Sagax du user qui est le owner de la page".
// The page's person's app tells the server its look (PUT /api/pages/look,
// src/lib/page-look-sync.ts): the tokens of their skin as the browser
// resolves them (skin, variant, colors, Geist, radii), in its light and its
// dark scheme, and whether the accent follows the bot's color. The server
// keeps only the token names it knows and only values safeTokenValue
// accepts (the same rule as #1551's `skin=`), and draws with them:
//
// - the reader's bar (server/pages/published-pages-render.ts readerBar): a small
//   stylesheet of `--sb-*` variables, light, and dark by the reader's
//   system, the same rule #1551 gives a reading link's frame;
// - the page's frame (pageThemeCss `schemes`), so a reader always sees the
//   page in its author's colors.
//
// Pure: no DOM, read by the server, the app and the reader's script.
import { botAccentVars, normalizeHex } from "./bot-accent-colors.ts";
import { WIDGET_THEME_TOKENS, fallbackWidgetTokens, safeTokenValue, type WidgetThemeTokens } from "./widget-kit.ts";

/** The app tokens a page look carries: the content theme's (#1551) plus
 * what the bar draws its buttons and corners with. */
export const PAGE_LOOK_TOKENS = [
  ...WIDGET_THEME_TOKENS,
  "--color-app",
  "--color-control",
  "--color-popover-border",
  "--color-accent-border",
  "--radius-lg",
  "--radius-xl",
] as const;

export type PageLookToken = (typeof PAGE_LOOK_TOKENS)[number];
export type PageLookTokens = Partial<Record<PageLookToken, string>>;
export type PageLookScheme = "light" | "dark";

/** What the person's app sends and the server keeps, per person. */
export interface PageLook {
  /** Their skin in a light scheme (its light sibling under Auto). */
  light?: PageLookTokens;
  /** Their skin in a dark scheme. */
  dark?: PageLookTokens;
  /** The skin worn (an id, for the record only). */
  skin?: string;
  /** Settings > Appearance > Use bot color as accent. */
  botAccent?: boolean;
}

/** At most this many characters of a stored look (JSON). */
export const PAGE_LOOK_MAX = 8 * 1024;

const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Only the known tokens, each one safe; anything else is dropped. */
export function sanitizeLookTokens(tokens: unknown): PageLookTokens {
  const out: PageLookTokens = {};
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return out;
  const record = tokens as Record<string, unknown>;
  for (const name of PAGE_LOOK_TOKENS) {
    const raw = record[name];
    const value = typeof raw === "string" ? safeTokenValue(raw) : undefined;
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** A look as the server keeps it: known tokens with safe values only; null
 * when nothing usable is left or it is too big. Pure. */
export function sanitizePageLook(value: unknown): PageLook | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    if (JSON.stringify(value).length > PAGE_LOOK_MAX) return null;
  } catch {
    return null;
  }
  const record = value as Record<string, unknown>;
  const light = sanitizeLookTokens(record.light);
  const dark = sanitizeLookTokens(record.dark);
  const has = (tokens: PageLookTokens) => Object.keys(tokens).length > 0;
  if (!has(light) && !has(dark)) return null;
  return {
    ...(has(light) ? { light: { ...light, "--code-color-scheme": "light" } } : {}),
    ...(has(dark) ? { dark: { ...dark, "--code-color-scheme": "dark" } } : {}),
    ...(typeof record.skin === "string" && SKIN_ID.test(record.skin) ? { skin: record.skin } : {}),
    ...(record.botAccent === true ? { botAccent: true } : {}),
  };
}

const FALLBACK_EXTRA: Record<PageLookScheme, Partial<Record<PageLookToken, string>>> = {
  light: { "--color-app": "#f6f6f6", "--color-control": "#f2f2f2", "--color-popover-border": "#c4c4c4", "--color-accent-border": "#2a78d6", "--radius-lg": "0.5rem", "--radius-xl": "0.75rem" },
  dark: { "--color-app": "#121212", "--color-control": "#1f1f1f", "--color-popover-border": "#4a4a4a", "--color-accent-border": "#f5f5f5", "--radius-lg": "0.5rem", "--radius-xl": "0.75rem" },
};

/** The person's tokens for one scheme, complete: theirs over the fallback
 * skin of that scheme, then their bot's color as the accent when they chose
 * it (held to 3:1 and 4.5:1 on their panel, as the app does). A look with
 * one scheme only (a skin with no sibling, such as Hibou 98) wears it in
 * both. Pure. */
export function lookTokens(look: PageLook | null | undefined, scheme: PageLookScheme, botColor?: string | null): PageLookTokens {
  const own = look?.[scheme] ?? look?.[scheme === "light" ? "dark" : "light"];
  const base: PageLookTokens = { ...FALLBACK_EXTRA[scheme], ...fallbackWidgetTokens(scheme) };
  const merged: PageLookTokens = { ...base, ...(own ? sanitizeLookTokens(own) : {}) };
  if (look?.botAccent && botColor) {
    const panel = normalizeHex(merged["--color-panel"]);
    const accent = panel ? botAccentVars(botColor, panel) : null;
    if (accent) Object.assign(merged, accent);
  }
  return merged;
}

/** The content theme's tokens (#1551) of a look, per scheme, for the page's
 * frame. Pure. */
export function lookContentTokens(look: PageLook | null | undefined, botColor?: string | null): Record<PageLookScheme, WidgetThemeTokens> {
  const pick = (tokens: PageLookTokens): WidgetThemeTokens => Object.fromEntries(WIDGET_THEME_TOKENS.filter((name) => tokens[name] !== undefined).map((name) => [name, tokens[name]!]));
  return { light: pick(lookTokens(look, "light", botColor)), dark: pick(lookTokens(look, "dark", botColor)) };
}

const PILL = "999px";

/** The bar's variables for one scheme. A skin with square corners (its
 * --radius-xl is 0) gets square buttons too. Pure. */
export function readerBarVars(tokens: PageLookTokens): Record<string, string> {
  const token = (name: PageLookToken) => safeTokenValue(tokens[name]) ?? "";
  const square = /^0(?:px|rem)?$/.test(token("--radius-xl").trim());
  return {
    "color-scheme": token("--code-color-scheme") === "dark" ? "dark" : "light",
    "--sb-app": token("--color-app"),
    "--sb-bg": token("--color-panel"),
    "--sb-ink": token("--color-ink"),
    "--sb-ink-2": token("--color-ink-secondary"),
    "--sb-ink-3": token("--color-ink-tertiary"),
    "--sb-line": token("--color-hairline"),
    "--sb-raised": token("--color-raised"),
    "--sb-raised-hover": token("--color-raised-hover"),
    "--sb-control": token("--color-control"),
    "--sb-menu": token("--color-menu"),
    "--sb-inset": token("--color-inset"),
    "--sb-popover-line": token("--color-popover-border"),
    "--sb-accent": token("--color-accent"),
    "--sb-accent-ink": token("--color-accent-ink"),
    "--sb-accent-border": token("--color-accent-border"),
    "--sb-accent-text": token("--color-accent-text"),
    "--sb-focus": token("--color-focus"),
    "--sb-danger": token("--color-danger"),
    "--sb-warning": token("--color-warning"),
    "--sb-success": token("--color-success"),
    "--sb-font": token("--font-sans"),
    "--sb-radius-lg": token("--radius-lg"),
    "--sb-radius-xl": token("--radius-xl"),
    "--sb-pill": square ? "0px" : PILL,
  };
}

const declarations = (vars: Record<string, string>) => Object.entries(vars).filter(([, value]) => value !== "").map(([name, value]) => `${name}:${value}`).join(";");

/** The bar's stylesheet rules: light, and dark when the reader's system is
 * dark (the rule #1551 gives a reading link). Pure. */
export function readerBarThemeCss(look: PageLook | null | undefined, botColor?: string | null): string {
  const light = declarations(readerBarVars(lookTokens(look, "light", botColor)));
  const dark = declarations(readerBarVars(lookTokens(look, "dark", botColor)));
  return `:root{${light}}@media (prefers-color-scheme:dark){:root{${dark}}}`;
}
