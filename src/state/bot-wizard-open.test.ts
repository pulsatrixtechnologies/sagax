import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("the bot creation wizard's screen", () => {
  it("opens over New bot, on a new bot or on a bot's own draft, and closes", () => {
    expect(initialState.botWizard).toBeNull();
    const withNewBot = reducer(initialState, { type: "toggleNewBot", open: true });
    const opened = reducer(withNewBot, { type: "openBotWizard" });
    expect(opened.botWizard).toEqual({ botId: null });
    expect(opened.newBotOpen).toBe(false);
    expect(reducer(initialState, { type: "openBotWizard", botId: "bot-1", redo: true }).botWizard).toEqual({ botId: "bot-1", redo: true });
    expect(reducer(opened, { type: "closeBotWizard" }).botWizard).toBeNull();
  });

  it("opens for a read-only person so the view can show the note; Redo still opens on a bot", () => {
    const readOnly = { ...initialState, config: { viewer: { canCreateBots: false } } } as typeof initialState;
    // Lot 4: the creation view opens and shows the read-only note in place.
    expect(reducer(readOnly, { type: "openBotWizard" }).botWizard).toEqual({ botId: null });
    expect(reducer(readOnly, { type: "openBotWizard", botId: "bot-1", redo: true }).botWizard).toEqual({ botId: "bot-1", redo: true });
  });

  it("toggleNewBot opens and closes the creation view (one option, one place)", () => {
    const opened = reducer(initialState, { type: "toggleNewBot", open: true });
    expect(opened.botWizard).toEqual({ botId: null });
    expect(opened.newBotOpen).toBe(false);
    expect(reducer(opened, { type: "toggleNewBot", open: false }).botWizard).toBeNull();
  });

  it("Connect apps opens over it without closing it (its Tools step)", () => {
    const opened = reducer(initialState, { type: "openBotWizard", botId: "bot-1" });
    const apps = reducer(opened, { type: "togglePlugins", open: true, surface: "apps", botId: "bot-1" });
    expect(apps.pluginsOpen).toBe(true);
    expect(apps.activeView).toBe("apps");
    expect(apps.botWizard).toEqual({ botId: "bot-1" });
    // Leaving apps returns to the wizard in the main column.
    const back = reducer(apps, { type: "togglePlugins", open: false });
    expect(back.pluginsOpen).toBe(false);
    expect(back.activeView).toBe("chat");
    expect(back.botWizard).toEqual({ botId: "bot-1" });
  });

  it("leaves Connect apps / archived so the wizard fills the main column", () => {
    const fromApps = reducer(
      { ...initialState, activeView: "apps" as const, pluginsOpen: true },
      { type: "openBotWizard" },
    );
    expect(fromApps).toMatchObject({ botWizard: { botId: null }, activeView: "chat", pluginsOpen: false });
    const fromArchived = reducer(
      { ...initialState, activeView: "archived-bots" as const },
      { type: "openBotWizard", botId: "bot-1" },
    );
    expect(fromArchived).toMatchObject({ botWizard: { botId: "bot-1" }, activeView: "chat" });
  });
});
