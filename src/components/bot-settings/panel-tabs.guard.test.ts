// Guard (JC, 2026-11-05, #2085, Refs #2086): the bot panel has only the
// Details, Library and Computer tabs. No Roles tab: a recent refusal is one
// row in Details > Permissions. Listed in GUARD_TESTS (verify-merge.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { PANEL_TABS, visiblePanelTabs } from "./panel-tabs";

describe("bot panel tabs guard", () => {
  it("are Details, Library and Computer only", () => {
    expect([...PANEL_TABS]).toEqual(["details", "library", "computer"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: false })).toEqual(["details", "library", "computer"]);
  });

  it("have no Roles label and the panel renders no other tab body", () => {
    for (const catalog of [en, fr] as Record<string, string>[]) {
      expect(catalog).not.toHaveProperty("botPanel.tab.roles");
    }
    const dialog = readFileSync(new URL("../BotSettingsDialog.tsx", import.meta.url), "utf8");
    const bodies = [...dialog.matchAll(/tab === "([a-z]+)"/g)].map((match) => match[1]);
    expect(new Set(bodies)).toEqual(new Set(["details", "library", "computer"]));
  });
});
