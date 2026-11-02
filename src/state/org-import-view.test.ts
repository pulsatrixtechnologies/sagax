import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Org import view (lot 6)", () => {
  it("showOrgImport fills the content frame and closes overlays", () => {
    const withOverlays = {
      ...initialState,
      pluginsOpen: true,
      activeView: "apps" as const,
      appSettingsOpen: true,
      personPanelId: "ada",
      botWizard: { botId: null },
    };
    const opened = reducer(withOverlays, { type: "showOrgImport", staged: null });
    expect(opened.activeView).toBe("org-import");
    expect(opened.orgImportStaged).toBeNull();
    expect(opened.pluginsOpen).toBe(false);
    expect(opened.appSettingsOpen).toBe(false);
    expect(opened.personPanelId).toBeNull();
    expect(opened.botWizard).toBeNull();
  });

  it("showChat leaves the org import view", () => {
    const opened = reducer(initialState, { type: "showOrgImport" });
    expect(reducer(opened, { type: "showChat" }).activeView).toBe("chat");
    expect(reducer(opened, { type: "showChat" }).orgImportStaged).toBeNull();
  });
});
