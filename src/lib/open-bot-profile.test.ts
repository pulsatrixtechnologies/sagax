// Every way to the bot's profile opens the profile page in the main area, in
// place of the chat, never in the right DetailPanel (owner decision 2026-11-06, #2136,
// #2994). QA found the command palette's "{bot} settings", the team map's
// "Edit {bot}" card and the retro "Bot properties" still opening the right
// panel. The chat header pill keeps the bot panel (UX reference 2.3, #2149).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState, reducer, type Action, type AppState } from "@/state/store";
import { openBotProfile } from "./open-bot-profile";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const bots = [{ id: "nova", threadId: "t-nova" }, { id: "atlas", threadId: "t-atlas" }] as unknown as AppState["bots"];
const base = { ...initialState, bots, selectedId: "atlas" } as AppState;

function run(state: AppState, act: (dispatch: (action: Action) => void) => void) {
  let next = state;
  act((action) => { next = reducer(next, action); });
  return next;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("bot profile entry points (#2994)", () => {
  it("opens the profile page in the main area and closes the right panel", () => {
    const withPanel = reducer(base, { type: "toggleSettings", open: true, botId: "atlas" });
    expect(withPanel.settingsOpen).toBe(true);
    const next = run(withPanel, (dispatch) => openBotProfile(dispatch, "nova"));
    expect(next.personaEditor?.botId).toBe("nova");
    expect(next.settingsOpen).toBe(false);
    expect(next.computerOpen).toBe(false);
    expect(next.activeView).toBe("chat");
  });

  it("falls back to the bot panel on the companion connection, which has no profile page", () => {
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    const next = run(base, (dispatch) => openBotProfile(dispatch, "nova"));
    expect(next.personaEditor).toBeNull();
    expect(next.settingsOpen).toBe(true);
    expect(next.selectedId).toBe("nova");
  });

  it.each([
    ["command palette {bot} settings", "../components/CommandPalette.tsx", /case "botSettings":\s*openBotProfile\(dispatch, action\.botId\);/],
    ["team map card Edit {bot}", "../components/TeamCanvas.tsx-parts/BotCard.tsx", /aria-label=\{t\("canvas\.editBot", \{ name: bot\.name \}\)\}\s*onClick=\{\(\) => openBotProfile\(dispatch, bot\.id\)\}/],
    ["retro Bot properties", "../components/retro98/RetroChrome.tsx", /id: "profile", label: t\("retro\.cmd\.profile"\), disabled: !bot, run: \(\) => bot && openBotProfile\(dispatch, bot\.id\)/],
  ])("%s opens the profile page", (_name, path, wiring) => {
    expect(source(path)).toMatch(wiring);
  });

  it("renders the profile page as the main pane, never inside the DetailPanel", () => {
    const shell = source("../App.tsx-parts/ShellLayout.tsx");
    const start = shell.indexOf("main={profileFillsMain ? (");
    expect(start).toBeGreaterThan(-1);
    expect(shell.slice(start, shell.indexOf(") :", start))).toContain("<PersonaEditorModal />");
    expect(shell.match(/<PersonaEditorModal\b/g)).toHaveLength(1);
  });
});
