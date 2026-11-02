import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Archived bots view (lot 5)", () => {
  it("showArchivedBots fills the content frame and closes overlays", () => {
    const withOverlays = {
      ...initialState,
      pluginsOpen: true,
      activeView: "apps" as const,
      appSettingsOpen: true,
      personPanelId: "ada",
      botWizard: { botId: null },
      personaEditor: { botId: "ada", section: "overview" as const },
    };
    const opened = reducer(withOverlays, { type: "showArchivedBots" });
    expect(opened.activeView).toBe("archived-bots");
    expect(opened.pluginsOpen).toBe(false);
    expect(opened.appSettingsOpen).toBe(false);
    expect(opened.personPanelId).toBeNull();
    expect(opened.botWizard).toBeNull();
    expect(opened.personaEditor).toBeNull();
  });

  it("showChat leaves the archived bots list", () => {
    const opened = reducer(initialState, { type: "showArchivedBots" });
    expect(reducer(opened, { type: "showChat" }).activeView).toBe("chat");
  });
});
