// 2026-10-29: the bar under a routine's page. Words and icon while there is
// room, the icon alone (tooltip and aria-label) when there is not, and no two
// actions with the same icon (two identical "play" buttons were reported).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine } from "@/lib/routines";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: vi.fn() }) };
});
afterAll(() => vi.unstubAllGlobals());

const { RoutinePanelActions } = await import("./RoutinesSection");
const { ACTION_LABEL, ACTION_LABEL_MAIN } = await import("../ActionBar");
const { RoutineDetail } = await import("../routines/RoutineDetail");
const { RoutineRunDetail } = await import("../routines/RoutineRunDetail");

const bot = { id: "atlas", name: "Atlas", threadId: "t", color: "blue", tasks: [] } as unknown as Bot;
const routine = (enabled: boolean) => ({
  id: "r1", botId: "atlas", name: "Project health watch", prompt: "Check.", target: "bot", runOn: "maus", enabled, canRun: true, canEdit: true,
  schedule: { type: "daily", time: "09:00", weekdays: [1] }, nextRunAt: null, createdAt: 1, updatedAt: 1, timeoutMinutes: 30,
}) as unknown as Routine;
const noop = () => {};
const panel = (enabled: boolean) => renderToStaticMarkup(createElement(RoutinePanelActions, {
  routine: routine(enabled), bot, onStarted: noop, onToggle: noop, onEdit: noop, onDelete: noop,
}));
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>.*?<\/button>/g)].map((match) => match[0]);
const iconOf = (button: string) => /lucide-([a-z-]+)/.exec(button.replace(/lucide lucide-/, "lucide-"))?.[1];

describe("a routine's action bar", () => {
  it("names every action in words, folding to an icon with a tooltip only when the bar is tight", () => {
    const markup = panel(false);
    const all = buttons(markup);
    // 2026-11-03 (JC): exactly [Run now] [Edit] [Disable or Enable] [Delete].
    expect(all).toHaveLength(5);
    expect(all.map((button) => /aria-label="([^"]+)"/.exec(button)?.[1])).toEqual(["Run now", "Check routine", "Edit", "Enable", "Delete"]);
    for (const button of all) {
      const label = /aria-label="([^"]+)"/.exec(button)?.[1];
      expect(label).toBeTruthy();
      expect(button).toContain(`title="${label}"`);
      // the words are there; only a tight container hides them
      expect(button.includes(`<span class="${ACTION_LABEL}">`) || button.includes(`<span class="${ACTION_LABEL_MAIN}">`)).toBe(true);
      expect(button).toMatch(/<span class="[^"]+">[^<]+<\/span>/);
    }
    // Run now keeps its words longest; Edit, Enable and Delete fold first
    expect(all[0]).toContain(ACTION_LABEL_MAIN);
    for (const button of all.slice(1)) expect(button).toContain(`class="${ACTION_LABEL}"`);
  });

  it("never draws two actions with the same icon (Run now and Resume differ)", () => {
    for (const enabled of [true, false]) {
      const icons = buttons(panel(enabled)).map(iconOf);
      expect(icons.every(Boolean)).toBe(true);
      expect(new Set(icons).size).toBe(icons.length);
    }
    const paused = buttons(panel(false));
    expect(paused[0]).toContain('fill="currentColor"');
    expect(iconOf(paused[3]!)).toMatch(/circle-play|play-circle/);
  });

  it("the routine's page and the run's detail give each action its own icon and a tooltip", () => {
    const page = renderToStaticMarkup(createElement(RoutineDetail, {
      routine: routine(false), runs: [], bots: [bot], canRun: true, onOpenRun: noop, onRunNow: noop, onToggle: noop, onEdit: noop, onDelete: noop,
    }));
    const pageButtons = buttons(page.slice(page.indexOf("data-routine-actions")));
    const pageIcons = pageButtons.map(iconOf);
    expect(new Set(pageIcons).size).toBe(pageIcons.length);
    for (const button of pageButtons) expect(button).toMatch(/title="[^"]+"/);
    expect(page).toMatch(/data-routine-delete[^>]*aria-label="Delete"/);
    expect(page).not.toContain("data-routine-duplicate");
    expect(page).not.toContain("data-routine-logs");

    const run = { id: "x1", routineId: "r1", routineName: "Project health watch", prompt: "Check.", target: "bot", botId: "atlas", runOn: "maus", scheduledFor: 1, createdAt: 1, status: "completed", manual: false, executionThreadId: "e", resultsThreadId: "t", output: "ok" };
    const detail = renderToStaticMarkup(createElement(RoutineRunDetail, {
      run: run as never, routine: routine(true), bots: [bot], canRunAgain: true, canContinue: true,
      onRunAgain: noop, onContinue: noop, onOpenRoutine: noop, onLogs: noop,
    }));
    const runButtons = buttons(detail.slice(detail.indexOf("data-run-actions")));
    const runIcons = runButtons.map(iconOf);
    // 2026-10-29: no "Open results thread" any more (one conversation).
    expect(runIcons.length).toBeGreaterThanOrEqual(4);
    expect(detail).not.toContain("Open results thread");
    expect(new Set(runIcons).size).toBe(runIcons.length);
    for (const button of runButtons) expect(button).toMatch(/title="[^"]+"/);
  });
});
