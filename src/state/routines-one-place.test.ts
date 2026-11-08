// #2624: Routines live in one place, the Routines sub-page of the bot page.
// The bot side panel no longer lists them; every link to a routine opens the
// bot page there.
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

  it("no longer draws the routines in the bot side panel", () => {
    const panel = readFileSync(new URL("../components/BotSettingsDialog.tsx", import.meta.url), "utf8");
    expect(panel).not.toMatch(/<RoutinesSection/);
  });
});
