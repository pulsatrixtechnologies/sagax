// The docked screen panel and the artifact side panel share the frame's
// top bar / card pair with every other docked panel (#5486): `.content-topbar`
// (navy band and circle tokens on Pulsatrix Light) and `.content-card-body`
// (the light inset card under it). Height was already aligned (#5478);
// these classes are the skin's band and circle colours.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const chrome = read("./ScreenPanelChrome.tsx");
const screenPanel = read("./ScreenPanel.tsx");
const liveBrowser = read("./BrowserPanel.tsx-parts/LiveBrowserView.tsx");
const artifactPanel = read("./artifacts/ArtifactSidePanel.tsx");
const botPanel = read("./BotSettingsDialog.tsx");

describe("screen and artifact panels on the navy band (#5486)", () => {
  it("SCREEN_PANEL_TOP_ROW carries .content-topbar like every docked panel header", () => {
    const row = chrome.match(/export const SCREEN_PANEL_TOP_ROW = "([^"]+)"/)?.[1] ?? "";
    expect(row.split(/\s+/)).toEqual(expect.arrayContaining(["content-topbar"]));
    expect(botPanel).toMatch(/"content-topbar[\s"]/);
  });

  it("ScreenPanel's body below the top row is .content-card-body", () => {
    expect(screenPanel).toMatch(/className="content-card-body /);
    // ScreenPanelBar owns SCREEN_PANEL_TOP_ROW; the panel only calls bar(...).
    expect(screenPanel.indexOf("ScreenPanelBar")).toBeLessThan(screenPanel.indexOf('className="content-card-body'));
  });

  it("LiveBrowserView's compact shell puts the card under the tab row", () => {
    // Compact tabs go through docked.bar → ScreenPanelBar → SCREEN_PANEL_TOP_ROW.
    expect(liveBrowser).toMatch(/docked\.bar\(/);
    expect(liveBrowser).toMatch(/compact \? <div className="content-card-body /);
    const top = liveBrowser.indexOf("docked.bar(");
    const card = liveBrowser.indexOf('className="content-card-body');
    expect(top).toBeGreaterThanOrEqual(0);
    expect(card).toBeGreaterThan(top);
  });

  it("ArtifactSidePanel header and body carry the same pair", () => {
    expect(artifactPanel).toMatch(/data-artifact-side-panel-header[^>]*content-topbar|content-topbar[^"]*data-artifact-side-panel-header|"content-topbar[\s"]/);
    expect(artifactPanel).toMatch(/className="content-topbar /);
    expect(artifactPanel).toMatch(/className="content-card-body /);
    expect(artifactPanel.indexOf('className="content-topbar')).toBeLessThan(artifactPanel.indexOf('className="content-card-body'));
  });
});
