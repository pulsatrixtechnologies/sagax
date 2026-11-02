import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Archived bots window (restored)", () => {
  it("showArchivedBots opens the centred window and closes overlays", () => {
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
    expect(opened.archivedBotsOpen).toBe(true);
    expect(opened.activeView).toBe("apps");
    expect(opened.pluginsOpen).toBe(false);
    expect(opened.appSettingsOpen).toBe(false);
    expect(opened.personPanelId).toBeNull();
    expect(opened.botWizard).toBeNull();
    expect(opened.personaEditor).toBeNull();
  });

  it("closeArchivedBots and showChat leave the window", () => {
    const opened = reducer(initialState, { type: "showArchivedBots" });
    expect(reducer(opened, { type: "closeArchivedBots" }).archivedBotsOpen).toBe(false);
    expect(reducer(opened, { type: "showChat" }).archivedBotsOpen).toBe(false);
  });
});
