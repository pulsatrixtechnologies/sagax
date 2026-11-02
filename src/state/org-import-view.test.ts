import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Org import window (restored)", () => {
  it("showOrgImport opens the centred window and closes overlays", () => {
    const withOverlays = {
      ...initialState,
      pluginsOpen: true,
      activeView: "apps" as const,
      appSettingsOpen: true,
      personPanelId: "ada",
      botWizard: { botId: null },
    };
    const opened = reducer(withOverlays, { type: "showOrgImport", staged: null });
    expect(opened.orgImportOpen).toBe(true);
    expect(opened.orgImportStaged).toBeNull();
    expect(opened.activeView).toBe("apps");
    expect(opened.pluginsOpen).toBe(false);
    expect(opened.appSettingsOpen).toBe(false);
    expect(opened.personPanelId).toBeNull();
    expect(opened.botWizard).toBeNull();
  });

  it("closeOrgImport and showChat leave the window", () => {
    const opened = reducer(initialState, { type: "showOrgImport" });
    expect(reducer(opened, { type: "closeOrgImport" })).toMatchObject({ orgImportOpen: false, orgImportStaged: null });
    expect(reducer(opened, { type: "showChat" })).toMatchObject({ orgImportOpen: false, orgImportStaged: null });
  });
});
