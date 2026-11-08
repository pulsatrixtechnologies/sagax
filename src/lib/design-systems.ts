/** Design systems for design pages (#2717, kind "design" of the published
 * pages): a named set of CSS custom properties in open-design's shared token
 * schema (--bg, --surface, --fg, --muted, --border, --accent, --accent-on,
 * --font-display, --font-body, --text-*, --space-*, --radius-*, --elev-*).
 * A design's screens style themselves with var(--accent) and friends; the
 * system is written into the design itself as one <style> block, so a
 * version keeps the exact tokens it was drawn with and an export is
 * self-contained. Switching the system replaces that block (a new version).
 *
 * Built in: "sagax" (the person's own Sagax look, through the page theme's
 * --color-* variables) and four neutral systems vendored from open-design
 * (./design-systems-vendored.ts). A person's own systems (taken from their
 * code by the bot, design_tokens) are kept per person by the server
 * (server/pages/published-pages.ts). Pure. */
import { OPEN_DESIGN_SYSTEMS } from "./design-systems-vendored.ts";
import { safeTokenValue } from "./widget-kit.ts";

export interface DesignSystem {
  /** "sagax", a vendored id, or "own-<slug>" for a person's own system */
  id: string;
  name: string;
  summary?: string;
  tokens: Readonly<Record<string, string>>;
}

export const DESIGN_SYSTEM_LIMITS = { tokens: 160, name: 60, systemsPerOwner: 20 } as const;

/** The person's Sagax look, mapped onto the shared schema. */
const SAGAX_SYSTEM: DesignSystem = {
  id: "sagax",
  name: "Sagax",
  summary: "your own Sagax look: its colors, light and dark, and the Geist face.",
  tokens: {
    // the page frame's theme (widget-kit), resolved from the person's skin
    // light or dark: the app's --color-* names are not defined in the frame,
    // and a name the system also sets (--border, --muted, --accent) is read
    // from a sibling the system leaves alone, so nothing points at itself
    "--bg": "var(--background, #fff)",
    "--surface": "var(--card, #fff)",
    "--surface-warm": "var(--secondary, #f4f4f5)",
    "--fg": "var(--foreground, #111)",
    "--fg-2": "var(--muted-foreground, #555)",
    "--muted": "var(--subtle-foreground, #777)",
    "--border": "var(--input, #ddd)",
    "--border-soft": "var(--input, #ddd)",
    "--accent": "var(--primary, #2563eb)",
    "--accent-on": "var(--primary-foreground, #fff)",
    "--warn": "var(--warning, #b45309)",
    "--danger": "var(--destructive, #dc2626)",
    "--font-display": "Geist, system-ui, sans-serif",
    "--font-body": "Geist, system-ui, sans-serif",
    "--text-xs": "12px", "--text-sm": "14px", "--text-base": "16px", "--text-lg": "18px",
    "--text-xl": "22px", "--text-2xl": "30px", "--text-3xl": "40px",
    "--space-1": "4px", "--space-2": "8px", "--space-3": "12px", "--space-4": "16px",
    "--space-6": "24px", "--space-8": "32px", "--space-12": "48px",
    "--radius-sm": "6px", "--radius-md": "10px", "--radius-lg": "16px", "--radius-pill": "9999px",
    "--elev-raised": "0 10px 30px rgba(0, 0, 0, 0.12)",
  },
};

export const BUILTIN_DESIGN_SYSTEMS: readonly DesignSystem[] = [SAGAX_SYSTEM, ...OPEN_DESIGN_SYSTEMS];
export const DEFAULT_DESIGN_SYSTEM = SAGAX_SYSTEM.id;

const TOKEN_NAME = /^--[a-z0-9][a-z0-9-]{0,47}$/;
const MARK = "data-sagax-design-system";
const BLOCK = new RegExp(`<style\\b[^>]*\\b${MARK}="[^"]*"[^>]*>[\\s\\S]*?</style>`, "gi");

/** Tokens the bot or the person sent: an object of --name: value, or CSS
 * text with declarations (a :root{} block from their code). Names must be
 * custom properties; values pass the page theme's safety check. Null when
 * nothing usable is left. */
export function parseDesignTokens(input: unknown): Record<string, string> | null {
  if (typeof input === "string" && /^\s*\{\s*"/.test(input)) {
    try { return parseDesignTokens(JSON.parse(input) as unknown); } catch { /* read as CSS below */ }
  }
  const pairs: Array<[string, unknown]> = typeof input === "string"
    ? [...input.slice(0, 32_000).matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);?/g)].map((match) => [match[1]!, match[2]])
    : input && typeof input === "object" && !Array.isArray(input) ? Object.entries(input as Record<string, unknown>) : [];
  const tokens: Record<string, string> = {};
  for (const [rawName, rawValue] of pairs) {
    const name = rawName.trim().toLowerCase();
    if (!TOKEN_NAME.test(name) || typeof rawValue !== "string") continue;
    const value = safeTokenValue(rawValue);
    if (value === undefined) continue;
    tokens[name] = value;
    if (Object.keys(tokens).length >= DESIGN_SYSTEM_LIMITS.tokens) break;
  }
  return Object.keys(tokens).length ? tokens : null;
}

/** The id of a person's own system from its name: "own-" and a slug. */
export function ownDesignSystemId(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `own-${slug || "system"}`;
}

/** A system by id or name among the given ones (case-insensitive). */
export function findDesignSystem(systems: readonly DesignSystem[], wanted: string): DesignSystem | undefined {
  const key = wanted.trim().toLowerCase();
  return systems.find((system) => system.id === key) ?? systems.find((system) => system.name.toLowerCase() === key);
}

/** The <style> block of a system, marked with its id and name. */
export function designSystemStyle(system: DesignSystem): string {
  const declarations = Object.entries(system.tokens)
    .filter(([name, value]) => TOKEN_NAME.test(name) && safeTokenValue(value) !== undefined)
    .map(([name, value]) => `${name}:${value}`).join(";");
  const id = system.id.replace(/[^a-z0-9-]/g, "");
  const name = system.name.replace(/[<>"&]/g, "");
  return `<style ${MARK}="${id}" data-name="${name}">:root{${declarations}}</style>`;
}

/** The design with this system: the old block out, the new one first in
 * <head> (or first in the document). */
export function applyDesignSystem(content: string, system: DesignSystem): string {
  const style = designSystemStyle(system);
  const bare = content.replace(BLOCK, "");
  const head = /<head\b[^>]*>/i.exec(bare);
  if (head) return `${bare.slice(0, head.index + head[0].length)}${style}${bare.slice(head.index + head[0].length)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(bare);
  return doctype ? `${doctype[0]}${style}${bare.slice(doctype[0].length)}` : `${style}${bare}`;
}

/** The system a design was drawn with: its id and name, from its block. */
export function designSystemOf(content: string): { id: string; name: string } | null {
  const match = new RegExp(`<style\\b[^>]*\\b${MARK}="([^"]*)"[^>]*>`, "i").exec(content);
  if (!match) return null;
  const name = /\bdata-name="([^"]*)"/i.exec(match[0])?.[1];
  return { id: match[1]!, name: name || match[1]! };
}

/** The screens of a design: <section data-screen="Name" data-device="...">. */
export function designScreens(content: string): Array<{ name: string; device: string }> {
  return [...content.matchAll(/<section\b[^>]*\bdata-screen="([^"]*)"[^>]*>/gi)].map((match) => ({
    name: match[1]!,
    device: /\bdata-device="(phone|tablet|desktop)"/i.exec(match[0])?.[1]?.toLowerCase() ?? "phone",
  }));
}

/** The canvas around a design's screens: a dotted ground, each screen an
 * artboard at its device's width with its name above it. In the page
 * theme's layer, so the design's own styles win. Printing puts one screen
 * per sheet. A body holding screens becomes the canvas (:has), so the bot's
 * own <body> markup stays as written. */
export const DESIGN_CANVAS_CSS = [
  "html{background:var(--secondary,#f4f4f5)}",
  "body:has(>section[data-screen]){margin:0;min-height:100vh;padding:56px 40px;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:72px 48px;align-items:flex-start;justify-content:center;",
  "background-color:var(--secondary,#f4f4f5);background-image:radial-gradient(color-mix(in srgb,var(--foreground,#111) 14%,transparent) 1px,transparent 1px);background-size:20px 20px;",
  // the canvas follows the skin; the screen label keeps the canvas ink, read
  // here before a screen sets the frame's ink to its own
  "--canvas-label:var(--muted-foreground,#555);--canvas-edge:color-mix(in srgb,var(--foreground,#111) 12%,transparent)}",
  "body:has(>section[data-screen])>section[data-screen]{position:relative;flex:none;box-sizing:border-box;width:390px;min-height:844px;overflow:hidden;",
  "background:var(--bg,#fff);color:var(--fg,#111);font-family:var(--font-body,inherit);",
  // the frame theme colors headings and quiet text with its own ink: inside a
  // screen that ink is the screen's, or a dark skin writes white on white
  "--foreground:var(--fg,#111);--card-foreground:var(--fg,#111);--muted-foreground:var(--fg-2,#555);",
  "border-radius:36px;box-shadow:0 0 0 1px var(--canvas-edge,rgba(0,0,0,.12)),0 24px 60px rgba(0,0,0,.14)}",
  "body:has(>section[data-screen])>section[data-device=tablet]{width:820px;min-height:1180px;border-radius:24px}",
  "body:has(>section[data-screen])>section[data-device=desktop]{width:1280px;min-height:800px;border-radius:12px}",
  "body:has(>section[data-screen])>section[data-screen]::before{content:attr(data-screen);position:absolute;top:-28px;left:4px;font:500 13px/18px Geist,system-ui,sans-serif;color:var(--canvas-label,#555);white-space:nowrap}",
  "body:has(>section[data-screen])>section[data-screen]{overflow:visible}",
  "body:has(>section[data-screen])>section[data-screen]>*:first-child{border-top-left-radius:inherit;border-top-right-radius:inherit}",
  "@media print{html,body:has(>section[data-screen]){background:none}body:has(>section[data-screen]){display:block;padding:0}",
  "body:has(>section[data-screen])>section[data-screen]{margin:0 auto;box-shadow:none;break-after:page;break-inside:avoid}",
  "body:has(>section[data-screen])>section[data-screen]::before{display:none}}",
].join("");
