import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("toggleMemoryManager", () => {
  it("opens the right-panel manager and closes other right panels", () => {
    const withSettings = reducer(initialState, { type: "toggleSettings", open: true });
    const opened = reducer(withSettings, { type: "toggleMemoryManager", open: true });
    expect(opened.memoryManagerOpen).toBe(true);
    expect(opened.settingsOpen).toBe(false);
    expect(opened.computerOpen).toBe(false);
    expect(opened.personPanelId).toBeNull();
  });

  it("closes on toggle and when another view opens", () => {
    const opened = reducer(initialState, { type: "toggleMemoryManager", open: true });
    expect(reducer(opened, { type: "toggleMemoryManager", open: false }).memoryManagerOpen).toBe(false);
    expect(reducer(opened, { type: "showRoutines" }).memoryManagerOpen).toBe(false);
    expect(reducer(opened, { type: "showTeamMap" }).memoryManagerOpen).toBe(false);
  });
});
