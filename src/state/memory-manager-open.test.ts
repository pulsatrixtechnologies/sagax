import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("toggleMemoryManager", () => {
  it("opens Memory as a main-column page and closes other right panels", () => {
    const withSettings = reducer(initialState, { type: "toggleSettings", open: true });
    const opened = reducer(withSettings, { type: "toggleMemoryManager", open: true });
    expect(opened.memoryManagerOpen).toBe(true);
    expect(opened.activeView).toBe("memory");
    expect(opened.settingsOpen).toBe(false);
    expect(opened.computerOpen).toBe(false);
    expect(opened.personPanelId).toBeNull();
  });

  it("closes on toggle and when another view opens", () => {
    const opened = reducer(initialState, { type: "toggleMemoryManager", open: true });
    const closed = reducer(opened, { type: "toggleMemoryManager", open: false });
    expect(closed.memoryManagerOpen).toBe(false);
    expect(closed.activeView).toBe("chat");
    expect(reducer(opened, { type: "showRoutines" }).memoryManagerOpen).toBe(false);
    expect(reducer(opened, { type: "showTeamMap" }).memoryManagerOpen).toBe(false);
  });
});
