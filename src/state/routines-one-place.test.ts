// #2624: every link to a routine opens the Routines sub-page of the bot page.
// #2941 (the owner, 2026-11-08): the bot side panel lists the routines again, as
// Upcoming, but leaves those links to the sub-page (followFocus false).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { initialState, reducer, type AppState, type Bot } from "./store";

const bot = { id: "pepper", name: "Pepper", messages: [] } as unknown as Bot;
const withBot: AppState = { ...initialState, bots: [bot] };

describe("Routines in one place (#2624)", () => {
  it("opens a routine on the bot page's Routines sub-page, not in the side panel", () => {
    const opened = reducer(withBot, { type: "openRoutine", botId: "pepper", routineId: "r1" });
    expect(opened.personaEditor).toMatchObject({ botId: "pepper", section: "routines" });
    expect(opened.settingsOpen).toBe(false);
    expect(opened.routineFocus).toEqual({ botId: "pepper", routineId: "r1" });
    expect(reducer(withBot, { type: "openRoutine", botId: "gone", routineId: "r1" })).toBe(withBot);
  });

  it("opens a new routine there when no routine is named (Suggested > Add to meeting)", () => {
    const opened = reducer(withBot, { type: "openRoutine", botId: "pepper" });
    expect(opened.personaEditor?.section).toBe("routines");
    expect(opened.routineFocus).toEqual({ botId: "pepper", create: true });
  });

  it("draws the routines in the bot side panel, without taking the sub-page's focus (#2941)", () => {
    const panel = readFileSync(new URL("../components/BotSettingsDialog.tsx", import.meta.url), "utf8");
    expect(panel).toMatch(/<RoutinesSection[^>]*\bupcoming\b[^>]*followFocus=\{false\}/);
  });
});
