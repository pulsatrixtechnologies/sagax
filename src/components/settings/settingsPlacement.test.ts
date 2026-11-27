import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Available } from "../SettingsPrimitives";
import { CARD_KEYWORDS, SECTIONS } from "./settings-nav";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Settings placement (the owner 2026-11-08)", () => {
  it("Available renders nothing for an option made impossible by context", () => {
    expect(renderToStaticMarkup(createElement(Available, { when: false, children: createElement("p", null, "My Chrome") }))).toBe("");
    expect(renderToStaticMarkup(createElement(Available, { when: true, children: createElement("p", null, "ok") }))).toBe("<p>ok</p>");
  });

  it("Developer holds the moved cards, whatever Advanced mode says", () => {
    const dev = read("./DeveloperSettings.tsx");
    for (const needle of ["ModelsDeveloperCards", "OrgGrokBridgePolicy", "OrgGithubApp", "resetOnly", 'part="schedule"', "InterfaceModeRow"]) {
      expect(dev, needle).toContain(needle);
    }
    // #4457: the release notes are What's new on Updates, About its sub-page there
    expect(dev).not.toContain("requestReleaseNotes");
    const modal = read("../SettingsModal.tsx");
    for (const needle of ['data-settings-card="updates.links"', 'requestReleaseNotes("browse")', '<SubPageEntry id="updates.about"']) expect(modal, needle).toContain(needle);
    expect(modal).not.toContain('<SubPageEntry id="updates.advanced"');
    // M-20261127-068: Advanced is a row at the end of General
    const general = read("./AppPage.tsx");
    expect(general).toContain('<SubPageEntry id="general.advanced"');
    expect(general).toContain('t("settings.sub.advanced.summary")');
    // never folded: no advanced flag on the moved groups
    expect(dev).not.toMatch(/advanced\s*[=}]/);
  });

  it("Edit several is the standard right-aligned header action, not a tab", () => {
    const src = read("./BotModelsSettings.tsx");
    expect(src).toMatch(/editing \? PRIMARY_PILL : PILL, "ml-auto"/);
  });

  it("the Usage page's status lines use the Settings type scale", () => {
    const src = read("../UsageSection.tsx");
    expect(src).toContain("text-[13px] text-ink-secondary");
  });

  it("search finds the moved options on General (Advanced is the former Developer), not on Updates", () => {
    const general = SECTIONS.find((s) => s.id === "general")!.keywords;
    for (const k of ["advanced mode", "scheduled update", "github oauth", "server environment", "prompt cache"]) expect(general).toContain(k);
    const updates = SECTIONS.find((s) => s.id === "updates")!.keywords;
    for (const k of ["advanced mode", "scheduled update", "github oauth", "server environment", "prompt cache"]) expect(updates).not.toContain(k);
    expect(CARD_KEYWORDS["general.interface"]).toEqual([]);
  });
});
