// The switches in a bot's panel: since 2026-11-07 every switch has the one on
// colour, so the bot's colour no longer reaches them (botSwitchVars is empty).
import { describe, expect, it } from "vitest";
import { botSwitchActive } from "./bot-accent";
import { botSwitchVars } from "./switch-colors";

const base = { hasBot: true, activeView: "chat", appSettingsOpen: false, pluginsOpen: false, accentEnabled: false };

describe("botSwitchActive", () => {
  it("is on in the bot's chat, routines and tasks, whatever the accent setting says", () => {
    for (const activeView of ["chat", "routines", "code"]) expect(botSwitchActive({ ...base, activeView })).toBe(true);
  });
  it("is off outside the bot's panel: app settings, plugins, team map, approvals", () => {
    expect(botSwitchActive({ ...base, appSettingsOpen: true })).toBe(false);
    expect(botSwitchActive({ ...base, pluginsOpen: true })).toBe(false);
    for (const activeView of ["team-map", "approvals", "remote-sessions", "achievements"]) expect(botSwitchActive({ ...base, activeView })).toBe(false);
  });
  it("is off with no bot", () => {
    expect(botSwitchActive({ ...base, hasBot: false, accentEnabled: true })).toBe(false);
  });
  it("follows the bot everywhere once 'Use bot color as accent' is on", () => {
    expect(botSwitchActive({ ...base, activeView: "team-map", appSettingsOpen: true, accentEnabled: true })).toBe(true);
  });
});

describe("botSwitchVars", () => {
  it("is empty: the bot's colour never recolours a switch", () => {
    expect(botSwitchVars("#ff0000")).toEqual({});
    expect(botSwitchVars(null)).toEqual({});
  });
});
