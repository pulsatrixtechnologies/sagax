import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Connect apps opened from a bot", () => {
  it("remembers the bot a bot panel opened it on, and forgets it on close", () => {
    const opened = reducer(initialState, { type: "togglePlugins", open: true, botId: "maya" });
    expect(opened).toMatchObject({ pluginsOpen: true, activeView: "apps", pluginsBotId: "maya" });
    expect(reducer(opened, { type: "togglePlugins", open: false })).toMatchObject({ pluginsOpen: false, pluginsBotId: null, activeView: "chat" });
  });

  it("keeps that bot while it stays open, and opens on no bot from anywhere else", () => {
    const opened = reducer(initialState, { type: "togglePlugins", open: true, botId: "maya" });
    expect(reducer(opened, { type: "togglePlugins", open: true }).pluginsBotId).toBe("maya");
    expect(reducer(initialState, { type: "togglePlugins", open: true }).pluginsBotId).toBeNull();
    const closed = reducer(opened, { type: "togglePlugins", open: false });
    expect(reducer(closed, { type: "togglePlugins", open: true }).pluginsBotId).toBeNull();
  });
});

describe("a routine line in the conversation opens the routine", () => {
  it("opens its bot page on the Routines sub-page and asks for that routine's page once", () => {
    const state = { ...initialState, bots: [{ id: "maya", name: "Maya", hidden: false }] } as unknown as typeof initialState;
    const opened = reducer(state, { type: "openRoutine", botId: "maya", routineId: "r1" });
    // #2624: routines live on the bot page's Routines sub-page, not the side panel.
    expect(opened).toMatchObject({ personaEditor: { botId: "maya", section: "routines" }, settingsOpen: false, routineFocus: { botId: "maya", routineId: "r1" } });
    expect(reducer(opened, { type: "routineFocused" }).routineFocus).toBeNull();
    // a bot the person does not have opens nothing
    expect(reducer(state, { type: "openRoutine", botId: "ghost", routineId: "r1" })).toBe(state);
  });
});

describe("links to a tab of Connect apps (Providers was My accounts)", () => {
  it("opens on Pages, Providers or Sources, and the old accounts link leads to Providers", () => {
    for (const page of ["pages", "providers", "sources"] as const) {
      expect(reducer(initialState, { type: "togglePlugins", open: true, page }).pluginsPage).toBe(page);
    }
    expect(reducer(initialState, { type: "togglePlugins", open: true, page: "accounts" }).pluginsPage).toBe("providers");
    expect(reducer(initialState, { type: "togglePlugins", open: true }).pluginsPage).toBeNull();
  });
});
