// The default theme of a bot's page (2026-10-28): "les pages que les bots
// créent doivent avoir un style qui s'accorde à l'app". Every page the
// server serves in its sandboxed frame (server/pages/published-pages-render.ts
// pageDocument) carries this stylesheet inline, so it needs no request and
// keeps the same CSP: the person's skin tokens (light and dark), the app's
// Geist face as a data: font, plain content styled (headings, lists,
// tables, code), the widget kit's components (cards, badges, buttons,
// statistics, bar chart) and a centered layout with a reading width.
//
// It is a base, never a cage: everything sits in the `sagax-theme` cascade
// layer, and any rule of the page's own (unlayered) wins over it whatever
// its specificity. A Markdown page has no style of its own and follows the
// theme entirely. Pure: no DOM, read by the server and the app.
import {
  WIDGET_KIT_CSS,
  WIDGET_THEME_TOKENS,
  contentThemeVars,
  cssDeclarations,
  fallbackWidgetTokens,
  sanitizeWidgetTokens,
  type WidgetThemeTokens,
} from "./widget-kit.ts";

export type PageScheme = "light" | "dark";
export type PageThemeKind = "html" | "markdown" | "presentation";

/** The cascade layer the theme sits in: a page's own rules always win. */
export const PAGE_THEME_LAYER = "sagax-theme";
/** The id of the theme's <style> element in a page's document. */
export const PAGE_THEME_STYLE_ID = "sagax-page-theme";

/** The page layout over the widget kit: the ground, a centered column of
 * reading width, a page's type scale and spacing. */
export const PAGE_BASE_CSS = [
  // the ground is the body's: it paints the whole canvas, and a page that
  // sets its own body background replaces it everywhere
  "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}",
  "body{--page-width:960px;max-width:var(--page-width);margin:0 auto;padding:40px 24px 64px;overflow-x:visible;background:var(--background);color:var(--foreground);font-size:15px;line-height:24px}",
  "body.narrow,body.prose{--page-width:720px}body.wide{--page-width:1200px}body.full{--page-width:none}",
  "@media (max-width:640px){body{padding:24px 16px 48px}}",
  "h1{margin:0 0 12px;font-size:28px;line-height:34px;font-weight:600;letter-spacing:-.02em}",
  "h2{margin:32px 0 12px;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em}",
  "h3{margin:24px 0 8px;font-size:16px;line-height:24px;font-weight:600}h4{margin:20px 0 6px;font-size:14px;line-height:20px;font-weight:600}",
  "p{margin:0 0 14px}.lead{font-size:17px;line-height:26px}",
  ":where(ul,ol,blockquote,pre,table,.table-wrap,.bar-chart,.list,.alert,.tabs){margin-bottom:16px}:where(li){margin:4px 0}",
  ":where(pre){padding:12px 14px;font-size:13px;line-height:20px}code{font-size:13px}",
  ":where(table:not(.table)){font-size:14px}.table{font-size:14px}",
  ".page-header{margin-bottom:24px}.page-header>.eyebrow{margin-bottom:6px}.page-header>p:last-child{margin-bottom:0}",
  ".card{margin:0 0 16px}.card+.card{margin-top:0}.grid>.card,.grid-2>.card,.grid-3>.card,.row>.card,.stack>.card{margin:0}",
  ".grid,.grid-2,.grid-3,.stack{margin-bottom:16px}.card-content>:last-child,.card>:last-child{margin-bottom:0}",
  ".separator,hr{margin:32px 0}",
  "@media (max-width:640px){.grid-2,.grid-3{grid-template-columns:minmax(0,1fr)}}",
].join("");

/** What our own Markdown adds: its wrapper of tables, task items, the
 * address of an image, a struck word. */
const MARKDOWN_CSS = ".table-wrap{overflow-x:auto}.table-wrap>table{margin:0}li.task{list-style:none;margin-inline-start:-1.2em}del{color:var(--subtle-foreground)}.url{color:var(--muted-foreground);word-break:break-all}";

/** A presentation: one full-height slide per screen, the theme's colors. */
const PRESENTATION_CSS = "html{scroll-snap-type:y mandatory;scroll-behavior:smooth}"
  + "body{max-width:none;margin:0;padding:0;font-size:clamp(16px,2.4vw,30px);line-height:1.45}"
  + ".slide{position:relative;box-sizing:border-box;height:100vh;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;padding:6vh 8vw;border-bottom:1px solid var(--border);overflow:hidden}"
  + ".slide h1{font-size:2.2em;line-height:1.15;margin:0 0 .4em}.slide h2{font-size:1.6em;line-height:1.2;margin:0 0 .4em}.slide h3{font-size:1.2em;margin:0 0 .4em}.slide p,.slide li{font-size:1em;line-height:1.45}.slide ul,.slide ol{margin:.3em 0}"
  + ".slide pre{font-size:.7em;line-height:1.45}.slide code{font-size:.9em}"
  + "footer{position:absolute;inset-inline-end:3vw;bottom:2.5vh;display:flex;align-items:center;gap:.6em;font-size:14px;line-height:20px;color:var(--muted-foreground)}"
  + ".nav{display:inline-block;min-width:32px;height:32px;border:1px solid var(--border);border-radius:16px;text-align:center;line-height:30px;font-size:22px;text-decoration:none;color:inherit}.nav:hover{background:var(--accent)}";

/** The `:root` rules of the theme. With a scheme: that scheme only, from
 * the person's skin tokens when the app sent them, else from the fallback
 * skin of that scheme. Without one (a reading link): light, and dark when
 * the reader's system is dark, from the page's person's own look when the
 * server has it (`schemes`, src/lib/page-look.ts, 2026-10-29). */
export function pageThemeVars(scheme?: PageScheme, tokens?: WidgetThemeTokens, schemes?: Partial<Record<PageScheme, WidgetThemeTokens>>): string {
  const rule = (from: WidgetThemeTokens) => `:root{${cssDeclarations(contentThemeVars(from, "page").vars)}}`;
  // printed (Download PDF), a page is always on white, whatever the screen
  const print = `@media print{${rule(fallbackWidgetTokens("light"))}}`;
  if (scheme) {
    const skin = tokens ? sanitizeWidgetTokens(tokens) : {};
    return `${rule({ ...fallbackWidgetTokens(scheme), ...skin, "--code-color-scheme": scheme })}${print}`;
  }
  const of = (which: PageScheme) => ({ ...fallbackWidgetTokens(which), ...sanitizeWidgetTokens(schemes?.[which] ?? {}), "--code-color-scheme": which });
  return `${rule(of("light"))}@media screen and (prefers-color-scheme:dark){${rule(of("dark"))}}:root{color-scheme:light dark}${print}`;
}

/** The whole stylesheet of a page: the font, then the theme in its layer.
 * `font` is an @font-face rule (widgetFontFace), "" when none is there;
 * `schemes` the page's person's own tokens for a reading link (light and
 * dark, by the reader's system);
 * `extra` more rules of the server's own, in the layer (a presentation's
 * print sheet). */
export function pageThemeCss(input: { kind: PageThemeKind; scheme?: PageScheme; tokens?: WidgetThemeTokens; schemes?: Partial<Record<PageScheme, WidgetThemeTokens>>; font?: string; extra?: string }): string {
  const extra = input.kind === "markdown" ? `body{--page-width:720px}${MARKDOWN_CSS}`
    : input.kind === "presentation" ? `${MARKDOWN_CSS}${PRESENTATION_CSS}` : "";
  return `${input.font ?? ""}@layer ${PAGE_THEME_LAYER}{${pageThemeVars(input.scheme, input.tokens, input.schemes)}${WIDGET_KIT_CSS}${PAGE_BASE_CSS}${extra}${input.extra ?? ""}}`;
}

/** The <style> element a page's document starts with. */
export function pageThemeStyle(input: Parameters<typeof pageThemeCss>[0]): string {
  return `<style id="${PAGE_THEME_STYLE_ID}">${pageThemeCss(input)}</style>`;
}

// The person's skin travels with the app's preview address (`s=`), as the
// theme does (`theme=`): base64url of a JSON object of the app tokens. The
// server reads only the token names it knows and only values safeTokenValue
// accepts, so the parameter can never write anything but a color, a number
// or a font list into the page's style.

/** At most this many characters of `s=`; longer is ignored. */
export const SKIN_PARAM_MAX = 4096;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The app tokens as the `s=` value; "" when there is nothing to send. */
export function encodeSkinTokens(tokens: WidgetThemeTokens | undefined): string {
  const safe = sanitizeWidgetTokens(tokens ?? {});
  if (!Object.keys(safe).length) return "";
  const value = base64url(new TextEncoder().encode(JSON.stringify(safe)));
  return value.length <= SKIN_PARAM_MAX ? value : "";
}

/** Read `s=` back: only the known tokens with safe values; undefined for
 * anything else (empty, too long, not base64url, not a JSON object). */
export function decodeSkinTokens(value: string | null | undefined): WidgetThemeTokens | undefined {
  if (!value || value.length > SKIN_PARAM_MAX || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const tokens = sanitizeWidgetTokens(parsed as Record<string, unknown>);
    return Object.keys(tokens).length ? tokens : undefined;
  } catch {
    return undefined;
  }
}

/** The token names `s=` may carry (for the tests and the iOS port). */
export const SKIN_TOKEN_NAMES: readonly string[] = WIDGET_THEME_TOKENS;
