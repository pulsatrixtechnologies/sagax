import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Achievements page state", () => {
  it("opens as a page of the content frame, closing the pop-ups and panels over it", () => {
    const withSettings = reducer(initialState, { type: "toggleAppSettings", open: true, section: "appearance" });
    const opened = reducer({ ...withSettings, personPanelId: "ada" }, { type: "showAchievements" });
    expect(opened.activeView).toBe("achievements");
    expect(opened.appSettingsOpen).toBe(false);
    expect(opened.personPanelId).toBeNull();
    expect(opened.achievementsFocus.category).toBe("all");
    expect(initialState.activeView).toBe("chat");
  });

  it("opens on the category a link names, and every open bumps the nonce", () => {
    const first = reducer(initialState, { type: "showAchievements", category: "mastery" });
    expect(first.achievementsFocus.category).toBe("mastery");
    const second = reducer(first, { type: "showAchievements", category: "settings" });
    expect(second.achievementsFocus.category).toBe("settings");
    expect(second.achievementsFocus.nonce).toBeGreaterThan(first.achievementsFocus.nonce);
    expect(reducer(second, { type: "showAchievements" }).achievementsFocus.category).toBe("all");
  });

  it("opens on one achievement, and a plain open does not keep that card (#5069)", () => {
    const opened = reducer(initialState, { type: "showAchievements", category: "mastery", achievementId: "not-so-fast" });
    expect(opened.activeView).toBe("achievements");
    expect(opened.achievementsFocus.category).toBe("mastery");
    expect(opened.achievementsFocus.achievementId).toBe("not-so-fast");
    const again = reducer(opened, { type: "showAchievements" });
    expect(again.achievementsFocus.category).toBe("all");
    expect(again.achievementsFocus.achievementId).toBeUndefined();
    expect(again.achievementsFocus.nonce).toBeGreaterThan(opened.achievementsFocus.nonce);
  });

  it("leaves for another screen or back to the chat", () => {
    const opened = reducer(initialState, { type: "showAchievements" });
    expect(reducer(opened, { type: "showChat" }).activeView).toBe("chat");
    expect(reducer(opened, { type: "showRoutines" }).activeView).toBe("routines");
    expect(reducer(opened, { type: "showTeamMap" }).activeView).toBe("team-map");
  });
});
