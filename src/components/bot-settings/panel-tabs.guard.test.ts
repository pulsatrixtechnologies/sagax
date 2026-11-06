// Guard (JC, 2026-11-05, #2085, Refs #2086; #2125): the bot panel has only the
// Activity and Library tabs, as the reference design. No Roles tab: a recent
// refusal is one row in Activity > Permissions. No Computer tab: Activity >
// Computer opens the computer view. Listed in GUARD_TESTS (verify-merge.mjs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { PANEL_TABS, visiblePanelTabs } from "./panel-tabs";

describe("bot panel tabs guard", () => {
  it("are Activity and Library only", () => {
    expect([...PANEL_TABS]).toEqual(["activity", "library"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: false })).toEqual(["activity", "library"]);
  });

  it("have no Roles label and the panel renders no other tab body", () => {
    for (const catalog of [en, fr] as Record<string, string>[]) {
      expect(catalog).not.toHaveProperty("botPanel.tab.roles");
    }
    const dialog = readFileSync(new URL("../BotSettingsDialog.tsx", import.meta.url), "utf8");
    const bodies = [...dialog.matchAll(/tab === "([a-z]+)"/g)].map((match) => match[1]);
    expect(new Set(bodies)).toEqual(new Set(["activity", "library"]));
  });
});
