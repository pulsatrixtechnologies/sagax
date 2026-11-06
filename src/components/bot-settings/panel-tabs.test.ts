import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { PANEL_TABS } from "./panel-tabs";

describe("bot panel tabs", () => {
  it("run Activity then Library, with no Capabilities, More or Roles tab", () => {
    expect(PANEL_TABS).toEqual(["activity", "library"]);
  });

  it("are labelled in English and French, with no Routines or More tab", () => {
    const labels = (catalog: Record<string, string>) => PANEL_TABS.map((id) => catalog[`botPanel.tab.${id}`]);
    expect(labels(en)).toEqual(["Activity", "Library"]);
    expect(labels(fr)).toEqual(["Activité", "Bibliothèque"]);
    for (const catalog of [en, fr]) {
      expect(catalog).not.toHaveProperty("botPanel.tab.routines");
      expect(catalog).not.toHaveProperty("botPanel.tab.more");
      expect(catalog).not.toHaveProperty("botPanel.tab.roles");
      expect(catalog).not.toHaveProperty("botPanel.tab.capabilities");
    }
  });

  it("labels the persona entry", () => {
    expect(en["botPanel.editPersona"]).toBe("Edit persona");
    expect(fr["botPanel.editPersona"]).toBe("Modifier le bot");
  });
});
