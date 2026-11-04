import { describe, expect, it } from "vitest";

import { initialState, reducer, type AppState, type Bot } from "./store";

const bot = { id: "pepper", name: "Pepper" } as Bot;
const withBot: AppState = { ...initialState, bots: [bot] };

describe("Persona editor state", () => {
  it("opens on Overview for a known bot, moves between sections and closes", () => {
    expect(initialState.personaEditor).toBeNull();
    expect(reducer(withBot, { type: "openPersonaEditor", botId: "gone" })).toBe(withBot);
    const opened = reducer(withBot, { type: "openPersonaEditor", botId: "pepper" });
    expect(opened.personaEditor).toEqual({ botId: "pepper", section: "overview" });
    const soul = reducer(opened, { type: "personaEditorSection", section: "soul" });
    expect(soul.personaEditor).toEqual({ botId: "pepper", section: "soul" });
    expect(reducer(soul, { type: "closePersonaEditor" }).personaEditor).toBeNull();
    expect(reducer(withBot, { type: "personaEditorSection", section: "soul" })).toBe(withBot);
  });

  it("is one modal at a time with Settings and Achievements, and keeps the bot panel open", () => {
    const panel = reducer(withBot, { type: "toggleSettings", open: true });
    const withSettings = reducer(panel, { type: "toggleAppSettings", open: true });
    const opened = reducer(withSettings, { type: "openPersonaEditor", botId: "pepper", section: "model" });
    expect(opened.appSettingsOpen).toBe(false);
    expect(opened.personaEditor?.section).toBe("model");
    expect(reducer(panel, { type: "openPersonaEditor", botId: "pepper" }).settingsOpen).toBe(true);
    expect(reducer(opened, { type: "toggleAppSettings", open: true }).personaEditor).toBeNull();
    expect(reducer(opened, { type: "showAchievements" }).personaEditor).toBeNull();
  });

  it("reroutes a settings deep link that used to land on More to the persona editor", () => {
    const open = (section: never) => reducer(withBot, { type: "toggleSettings", open: true, botId: "pepper", section });
    expect(open("access" as never).personaEditor).toEqual({ botId: "pepper", section: "access" });
    expect(open("voice" as never).personaEditor?.section).toBe("voice");
    expect(open("soul" as never).personaEditor?.section).toBe("soul");
    // every section is its own page: the link keeps it (owner 2026-10-15)
    expect(open("worksOn" as never).personaEditor?.section).toBe("worksOn");
    expect(open("sharing" as never).personaEditor?.section).toBe("sharing");
    expect(open("appearance" as never).personaEditor?.section).toBe("appearance");
    expect(open("perspicax" as never).personaEditor?.section).toBe("overview");
    expect(open("access" as never).settingsOpen).toBe(true);
  });

  it("keeps Details and Routines links in the bot panel", () => {
    for (const section of ["details", "routines"] as const) {
      const next = reducer(withBot, { type: "toggleSettings", open: true, botId: "pepper", section });
      expect(next.personaEditor).toBeNull();
      expect(next.botSettingsSection).toBe(section);
    }
    expect(reducer(withBot, { type: "toggleSettings", open: true }).personaEditor).toBeNull();
  });

  it("leaves Connect apps / archived so the editor fills the main column", () => {
    const fromApps = reducer(
      { ...withBot, activeView: "apps" as const, pluginsOpen: true },
      { type: "openPersonaEditor", botId: "pepper" },
    );
    expect(fromApps).toMatchObject({
      personaEditor: { botId: "pepper", section: "overview" },
      activeView: "chat",
      pluginsOpen: false,
      botWizard: null,
    });
    const fromArchived = reducer(
      { ...withBot, archivedBotsOpen: true },
      { type: "openPersonaEditor", botId: "pepper", section: "soul" },
    );
    expect(fromArchived).toMatchObject({
      personaEditor: { botId: "pepper", section: "soul" },
      archivedBotsOpen: false,
    });
  });
});
