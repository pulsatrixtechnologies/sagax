// The shadcn/ui kit of a ```widget document: themed from the Sagax skin,
// transparent, offline.
import { describe, expect, it } from "vitest";

import { buildWidgetDocument, WIDGET_CSP } from "./rich-blocks";
import { safeTokenValue, WIDGET_KIT_CSS, WIDGET_THEME_LISTENER, WIDGET_THEME_MESSAGE, widgetFontFace, widgetThemeFromTokens } from "./widget-kit";

const MIDNIGHT = {
  "--code-color-scheme": "dark",
  "--color-ink": "#f5f5f5",
  "--color-panel": "#161616",
  "--color-raised": "#1f1f1f",
  "--color-accent": "#f5f5f5",
  "--color-accent-ink": "#121212",
  "--color-hairline": "#353535",
  "--color-danger": "#ff6463",
  "--font-sans": "\"Geist Variable\", -apple-system, system-ui, sans-serif",
} as const;

describe("widget theme", () => {
  it("computes the shadcn variables from the active skin's tokens", () => {
    const theme = widgetThemeFromTokens(MIDNIGHT);
    expect(theme.scheme).toBe("dark");
    for (const name of ["--background", "--foreground", "--card", "--card-foreground", "--popover", "--primary", "--primary-foreground", "--secondary", "--muted", "--muted-foreground", "--accent", "--destructive", "--border", "--input", "--ring", "--radius", "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"]) {
      expect(theme.css).toContain(`${name}:`);
    }
    expect(theme.css).toContain("--foreground:#f5f5f5");
    expect(theme.css).toContain("--card:#161616");
    expect(theme.css).toContain("--primary-foreground:#121212");
    expect(theme.css).toContain("--destructive:#ff6463");
    expect(theme.css).toContain("--border:color-mix(in srgb, #353535 50%, transparent)");
    expect(theme.css).toContain("--font-sans:\"Geist Variable\"");
    expect(theme.css).toContain("color-scheme:dark");
  });

  it("follows a light skin and falls back per scheme when a token is missing", () => {
    const light = widgetThemeFromTokens({ "--code-color-scheme": "light", "--color-ink": "#101820" });
    expect(light.scheme).toBe("light");
    expect(light.css).toContain("--foreground:#101820");
    expect(light.css).toContain("--card:#ffffff");
    expect(light.css).toContain("color-scheme:light");
    expect(widgetThemeFromTokens({}).css).toContain("--card:#161616");
  });

  it("never lets a token close the rule or name a resource", () => {
    expect(safeTokenValue("#fff}body{background:url(https://evil.test)")).toBeUndefined();
    expect(safeTokenValue("url(https://evil.test)")).toBeUndefined();
    expect(safeTokenValue("red;background:red")).toBeUndefined();
    expect(safeTokenValue("\"Geist")).toBeUndefined();
    expect(safeTokenValue("</style><script>")).toBeUndefined();
    expect(safeTokenValue("color-mix(in srgb, #fff 3%, #111)")).toBe("color-mix(in srgb, #fff 3%, #111)");
    const theme = widgetThemeFromTokens({ "--color-ink": "#fff}html{background:red", "--color-panel": "url(https://evil.test)" });
    expect(theme.css).not.toContain("evil.test");
    expect(theme.css).not.toContain("background:red");
    expect(theme.css).toContain("--foreground:#f5f5f5");
  });
});

describe("widget document", () => {
  it("is transparent: no ground on html or body, the background variable is transparent", () => {
    const doc = buildWidgetDocument("<div class=\"card\">x</div>", widgetThemeFromTokens(MIDNIGHT));
    expect(doc).toContain("--background:transparent");
    expect(WIDGET_KIT_CSS).toContain("html,body{margin:0;padding:0;background:transparent}");
    expect(WIDGET_KIT_CSS).not.toMatch(/body\{[^}]*background:var\(/);
    expect(doc).not.toContain("--omb-bg:#");
  });

  it("carries the kit classes, the theme first and the widget's own styles last", () => {
    const doc = buildWidgetDocument("<style>.card{background:#ffeedd}</style><div class=\"card\"></div>", "dark");
    for (const selector of [".card{", ".card-header{", ".card-title{", ".card-description{", ".card-content{", ".card-footer{", ".btn{", ".btn-secondary{", ".btn-outline{", ".btn-ghost{", ".btn-destructive{", ".btn-sm{", ".btn-lg{", ".badge{", ".badge-secondary{", ".badge-outline{", ".badge-destructive{", ".input,", ".textarea{", ".select{", ".checkbox{", ".switch{", ".tabs-list{", ".tabs-trigger[aria-selected=true]", ".table{", ".separator,", ".progress{", ".alert{", ".avatar{", ".skeleton{", ".kbd{", ".eyebrow{", ".search{"]) {
      expect(doc).toContain(selector);
    }
    // a widget that sets its own colors still wins: its <style> comes after the kit
    expect(doc.indexOf("sagax-theme")).toBeLessThan(doc.indexOf("sagax-kit"));
    expect(doc.indexOf("sagax-kit")).toBeLessThan(doc.indexOf("#ffeedd"));
    // older widgets that read the --omb-* names still get them
    expect(doc).toContain("--omb-fg:");
  });

  it("keeps the CSP first and reaches no network: the kit, the font and the masks are inline", () => {
    const doc = buildWidgetDocument("<p>x</p>", "light", widgetFontFace("data:font/woff2;base64,AAAA"));
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("sagax-theme"));
    expect(doc).toContain(WIDGET_CSP);
    const urls = [...doc.matchAll(/url\(\s*["']?([^"')\s]+)/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/^data:/);
    expect(doc).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(doc).not.toContain("@import");
    expect(widgetFontFace("https://evil.test/font.woff2")).toBe("");
  });

  it("listens for a new theme from the parent only", () => {
    const doc = buildWidgetDocument("", "dark");
    expect(doc).toContain(WIDGET_THEME_LISTENER);
    expect(WIDGET_THEME_LISTENER).toContain("e.source!==parent");
    expect(WIDGET_THEME_LISTENER).toContain(WIDGET_THEME_MESSAGE);
    expect(WIDGET_THEME_LISTENER).toContain("getElementById('sagax-theme')");
  });

  it("reports the body's height, so the frame shrinks to the widget", () => {
    const doc = buildWidgetDocument("", "dark");
    expect(doc).toContain("getBoundingClientRect().height");
  });
});

describe("widget kit form rows", () => {
  it("keeps the control look on the input and lets a wrapping label flow as one row", async () => {
    const { WIDGET_KIT_CSS } = await import("./widget-kit");
    expect(WIDGET_KIT_CSS).toContain("input.checkbox{appearance:none");
    expect(WIDGET_KIT_CSS).not.toMatch(/(^|[,}"])\.checkbox\{appearance/);
    expect(WIDGET_KIT_CSS).toContain("label.checkbox");
    expect(WIDGET_KIT_CSS).toContain("user-select:none");
  });
});
