import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { PANEL_TABS, visiblePanelTabs } from "./panel-tabs";

describe("bot panel tabs", () => {
  it("run Details, Library, Roles, Computer in that order, with no Capabilities or More tab", () => {
    expect(PANEL_TABS).toEqual(["details", "library", "roles", "computer"]);
  });

  it("show Roles in Advanced on an organization server only; Simple hides it with Computer", () => {
    expect(visiblePanelTabs({ advanced: true, computerOff: false, rolesOff: false })).toEqual(["details", "library", "roles", "computer"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: false, rolesOff: true })).toEqual(["details", "library", "computer"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: false })).toEqual(["details", "library", "computer"]);
    expect(visiblePanelTabs({ advanced: false, computerOff: false, rolesOff: false })).toEqual(["details", "library"]);
  });

  it("are labelled in English and French, with no Routines or More tab", () => {
    const labels = (catalog: Record<string, string>) => PANEL_TABS.map((id) => catalog[`botPanel.tab.${id}`]);
    expect(labels(en)).toEqual(["Details", "Library", "Roles", "Computer"]);
    expect(labels(fr)).toEqual(["Détails", "Bibliothèque", "Rôles", "Ordinateur"]);
    for (const catalog of [en, fr]) {
      expect(catalog).not.toHaveProperty("botPanel.tab.routines");
      expect(catalog).not.toHaveProperty("botPanel.tab.more");
      expect(catalog).not.toHaveProperty("botPanel.tab.capabilities");
    }
  });

  it("labels the persona entry", () => {
    expect(en["botPanel.editPersona"]).toBe("Edit persona");
    expect(fr["botPanel.editPersona"]).toBe("Modifier le bot");
  });
});
