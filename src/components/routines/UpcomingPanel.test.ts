import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { Bot } from "@/state/store";
import { addBotCalendarDrag, BOT_CALENDAR_DRAG_TYPE } from "@/lib/bot-drag";
import { routineNextRunPhrase, routineUpcomingState, upcomingRoutines } from "@/lib/routine-display";
import { CalendarSidebar } from "./CalendarSidebar";
import { RoutineList } from "./RoutineList";

// 2026-10-18 (owner): the calendar's right panel lists what runs next, in the
// list view's own rows, and bots are dragged from the left sidebar.
const NOW = new Date(2026, 9, 18, 8, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).getTime();
const base: Routine = {
  id: "brief", name: "Morning brief", prompt: "Report", target: "bot", botId: "scout", runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes: 60, anchorAt: 1 }, durationMinutes: 30, nextRunAt: at(18, 9), createdAt: 1, updatedAt: 1,
};
const bot = { id: "scout", name: "Scout", title: "", description: "" } as unknown as Bot;

afterEach(() => vi.useRealTimers());

describe("upcoming routines", () => {
  it("keeps the routines that will run, soonest first", () => {
    const later = { ...base, id: "later", name: "Later", nextRunAt: at(20, 9) };
    const paused = { ...base, id: "paused", name: "Paused", enabled: false };
    const suspended = { ...base, id: "suspended", name: "Suspended", suspended: { reason: "person_out" as const, at: 1 } };
    const finished = { ...base, id: "done", name: "Done", nextRunAt: undefined };
    const soon = { ...base, id: "soon", name: "Soon", nextRunAt: at(18, 8) };
    expect(upcomingRoutines([later, paused, suspended, finished, base, soon] as Routine[]).map((routine) => routine.id)).toEqual(["soon", "brief", "later"]);
  });

  it("says the next run in words", () => {
    expect(routineNextRunPhrase(at(18, 9), NOW)).toMatch(/^Today at 9:00/);
    expect(routineNextRunPhrase(at(19, 9), NOW)).toMatch(/^Tomorrow at 9:00/);
    expect(routineNextRunPhrase(at(21, 9), NOW)).toMatch(/^Wednesday at 9:00/);
    expect(routineNextRunPhrase(at(30, 9), NOW)).toMatch(/^October 30 at 9:00/);
    expect(routineNextRunPhrase(new Date(2027, 0, 4, 9).getTime(), NOW)).toMatch(/^January 4, 2027 at 9:00/);
  });

  it("names the state: in flight, failing or active", () => {
    const running = [{ routineId: "brief", status: "running" }] as RoutineRun[];
    expect(routineUpcomingState(base, running)).toEqual({ label: "Running", tone: "info" });
    expect(routineUpcomingState({ ...base, failureStreak: 2 }, [])).toEqual({ label: "Failing", tone: "warning" });
    expect(routineUpcomingState(base, [{ routineId: "other", status: "running" }] as RoutineRun[])).toEqual({ label: "Active", tone: "neutral" });
  });
});

describe("the upcoming rows", () => {
  it("reuse the list's row with the bot and the next run in words, no Active pill and no switch", () => {
    vi.useFakeTimers({ now: NOW });
    const markup = renderToStaticMarkup(createElement(RoutineList, { variant: "upcoming", routines: [base], runs: [], bots: [bot], onOpen: vi.fn() }));
    expect(markup).toContain("data-routine-row");
    expect(markup).toContain("Morning brief");
    expect(markup).toMatch(/data-routine-bot[^>]*>Scout</);
    expect(markup).toMatch(/data-routine-when="Today at 9:00/);
    expect(markup).not.toContain("data-routine-state");
    expect(markup).not.toContain(">Active<");
    expect(markup).not.toContain('role="switch"');
    expect(markup).toContain('aria-label="Upcoming routines"');
  });

  it("still shows Running while a run is in flight", () => {
    vi.useFakeTimers({ now: NOW });
    const running = [{ routineId: "brief", status: "running" }] as RoutineRun[];
    const markup = renderToStaticMarkup(createElement(RoutineList, { variant: "upcoming", routines: [base], runs: running, bots: [bot], onOpen: vi.fn() }));
    expect(markup).toMatch(/data-routine-state[^>]*>Running</);
  });

  it("leave the list view's rows as they were", () => {
    const markup = renderToStaticMarkup(createElement(RoutineList, { routines: [base], runs: [], bots: [bot], onOpen: vi.fn() }));
    expect(markup).toContain('data-routine-when="Every hour"');
    expect(markup).not.toContain("data-routine-state");
    expect(markup).not.toContain("data-routine-bot");
    expect(markup).toContain('aria-label="Pause"');
  });
});

describe("the calendar's right panel", () => {
  const panel = (routines: Routine[]) => renderToStaticMarkup(createElement(CalendarSidebar, {
    anchor: NOW, onSelectDate: vi.fn(), routines, runs: [], bots: [bot], onOpenRoutine: vi.fn(), onCollapse: vi.fn(),
  }));

  it("shows the month, then the upcoming routines, and no bot list", () => {
    const markup = panel([base]);
    expect(markup).toContain(">Upcoming<");
    expect(markup).toContain("Morning brief");
    expect(markup).not.toMatch(/My bots|Search bots/);
    expect(markup).toContain("Drag a bot from the left sidebar onto a time to schedule it.");
  });

  it("says when nothing is scheduled", () => {
    expect(panel([])).toContain("Nothing scheduled yet.");
    const filtered = renderToStaticMarkup(createElement(CalendarSidebar, { anchor: NOW, onSelectDate: vi.fn(), routines: [], runs: [], bots: [], onOpenRoutine: vi.fn(), filteredOut: true }));
    expect(filtered).toContain("No upcoming run for these filters.");
  });
});

describe("dragging a bot from the left sidebar", () => {
  it("carries the calendar's payload beside the sidebar's own", () => {
    const data = new Map<string, string>();
    const transfer = { effectAllowed: "move", setData: (type: string, value: string) => void data.set(type, value) } as unknown as DataTransfer;
    addBotCalendarDrag(transfer, "scout");
    expect(data.get(BOT_CALENDAR_DRAG_TYPE)).toBe("scout");
    expect(transfer.effectAllowed).toBe("copyMove");
  });

  it("is wired on every bot row of the sidebar and read by the calendar", () => {
    // #1383: the sidebar's drag wiring lives in its section DnD hook.
    const sidebar = readFileSync(join(process.cwd(), "src/components/Sidebar.tsx-parts/useSidebarSectionDnD.ts"), "utf8");
    expect(sidebar).toContain('if (kind === "bot") addBotCalendarDrag(event.dataTransfer, itemId);');
    // every bot and group row drags (the split view, #1504), the bot's with the calendar payload
    expect(sidebar).toContain("const itemDragProps = (kind: SectionItemKind, itemId: string) => ({");
    const calendar = readFileSync(join(process.cwd(), "src/components/RoutineCalendarPage.tsx"), "utf8");
    const calendarConstants = readFileSync(join(process.cwd(), "src/components/RoutineCalendarPage.tsx-parts/constants.ts"), "utf8");
    expect(calendarConstants).toContain("const BOT_DRAG_TYPE = BOT_CALENDAR_DRAG_TYPE;");
    expect(calendar).toContain("data-calendar-drop-target");
  });
});
