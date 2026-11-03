// The default theme of bot content (2026-10-28): pages and widgets draw in
// the app's look, light and dark, and the bots are told to use it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWidgetDocument } from "./rich-blocks.ts";
import { decodeSkinTokens, encodeSkinTokens, pageThemeCss, pageThemeVars, PAGE_THEME_LAYER } from "./page-theme.ts";
import { iosWidgetKitSource } from "./page-theme-ios.ts";
import { pageDocument } from "../../server/pages/published-pages-render.ts";
import { WIDGET_KIT_PROMPT } from "../../server/system-prompt.ts";
import { PAGE_TOOL_DEFINITIONS } from "../../server/drivers/agents-page-tools.ts";
import { APP_TOOL_DEFINITIONS } from "../../server/drivers/agents-app-tools.ts";

const COMPONENTS = [".card{", ".badge{", ".btn{", ".stat{", ".stat-card{", ".bar-chart{", ".list{", "svg.chart", ".table{"];

describe("the page theme", () => {
  it("is injected into every kind of page, before the page's own markup, in its own layer", () => {
    for (const kind of ["html", "markdown", "presentation"] as const) {
      const doc = pageDocument({ kind, title: "T", content: kind === "html" ? "<style>body{color:red}</style><h1>x</h1>" : "# x" }, { theme: "dark" });
      expect(doc).toContain(`@layer ${PAGE_THEME_LAYER}{`);
      for (const name of COMPONENTS) expect(doc).toContain(name);
      if (kind === "html") expect(doc.indexOf(`@layer ${PAGE_THEME_LAYER}`)).toBeLessThan(doc.indexOf("body{color:red}"));
    }
  });

  it("follows light and dark, and the reader's system when the app gives no theme", () => {
    expect(pageThemeVars("dark")).toContain("color-scheme:dark");
    expect(pageThemeVars("dark")).toContain("--background:#161616");
    expect(pageThemeVars("light")).toContain("color-scheme:light");
    expect(pageThemeVars("light")).toContain("--background:#ffffff");
    expect(pageThemeVars("light")).not.toContain("prefers-color-scheme");
    const both = pageThemeVars();
    expect(both).toContain("--background:#ffffff");
    expect(both).toContain("@media screen and (prefers-color-scheme:dark){:root{color-scheme:dark;--background:#161616");
    // printed, always on white
    expect(pageThemeVars("dark")).toContain("@media print{:root{color-scheme:light;--background:#ffffff");
  });

  it("takes the person's skin tokens and never an unsafe value", () => {
    const css = pageThemeCss({ kind: "html", scheme: "dark", tokens: { "--color-panel": "#060f20", "--color-ink": "red}</style><script>x()</script>" } });
    expect(css).toContain("--background:#060f20");
    expect(css).toContain("--foreground:#f5f5f5");
    expect(css).not.toContain("x()");
  });

  it("carries the skin in the preview address: known tokens and safe values only", () => {
    const value = encodeSkinTokens({ "--color-panel": "#060f20", "--font-sans": "\"Geist Variable\", sans-serif" });
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSkinTokens(value)).toEqual({ "--color-panel": "#060f20", "--font-sans": "\"Geist Variable\", sans-serif" });
    const sneaky = Buffer.from(JSON.stringify({ "--color-panel": "url(https://evil.test)", "--other": "#000", "--color-ink": "#111" })).toString("base64url");
    expect(decodeSkinTokens(sneaky)).toEqual({ "--color-ink": "#111" });
    for (const bad of ["", "%%%", "a".repeat(5000), Buffer.from("[1]").toString("base64url"), Buffer.from("nope").toString("base64url")]) {
      expect(decodeSkinTokens(bad)).toBeUndefined();
    }
  });
});

describe("the widget theme", () => {
  it("is in every widget document, with the new components, light and dark", () => {
    for (const scheme of ["light", "dark"] as const) {
      const doc = buildWidgetDocument("<div class=\"card\"></div>", scheme);
      expect(doc).toContain(`color-scheme:${scheme}`);
      for (const name of COMPONENTS) expect(doc).toContain(name);
    }
  });

  it("is the same on the phone (WidgetKit.generated.swift is current)", () => {
    const file = join(process.cwd(), "ios", "Sources", "CompanionCore", "WidgetKit.generated.swift");
    expect(readFileSync(file, "utf8")).toBe(iosWidgetKitSource());
  });
});

describe("the bots are told to use it", () => {
  it("the system prompt names the classes and the variables, and the page theme", () => {
    for (const word of [".card", ".stat-card", ".stat-delta", ".bar-chart", ".list", ".badge", ".btn", ".table", "svg.chart", "--foreground", "--card", "--primary", "--border", "--chart-1", "propose_page", "no colors, fonts or background of your own"]) {
      expect(WIDGET_KIT_PROMPT).toContain(word);
    }
  });

  it("propose_page and show_html say the theme is there and to use it", () => {
    const page = PAGE_TOOL_DEFINITIONS.find((tool) => tool.name === "propose_page")!.description;
    expect(page).toContain("Sagax's theme");
    expect(page).toContain("no hard-coded colors or fonts");
    const app = APP_TOOL_DEFINITIONS.find((tool) => tool.name === "show_html")!.description;
    expect(app).toContain("widget kit");
  });
});
