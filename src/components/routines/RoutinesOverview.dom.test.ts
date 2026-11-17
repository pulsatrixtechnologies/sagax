// @vitest-environment happy-dom
// The Routines page's Overview (2026-11-17): the Runs figures and the table
// with its row actions. Figures are tested in src/lib/routine-figures.test.ts.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";

// The reads are recorded: the trend asks once for its range, and the month's figures wait for theirs.
const reads = vi.hoisted(() => ({ trend: [] as Array<[number, number]>, from: [] as number[], covered: true }));
// A row's render is counted through the one helper it calls for its next-run text.
const drawn = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/lib/routine-display", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/routine-display")>();
  return { ...original, routineNextText: (routine: { id: string }) => { drawn.ids.push(routine.id); return original.routineNextText(routine as never); } };
});
vi.mock("@/state/older-routine-runs", () => ({
  useRoutineRunsFrom: (start: number) => { reads.from.push(start); },
  useRoutineTrendRuns: (start: number, per: number) => { reads.trend.push([start, per]); return "ready"; },
  useRoutineRunsCover: () => reads.covered,
}));
const { RoutinesOverview } = await import("./RoutinesOverview");

const NOW = Date.UTC(2026, 10, 17, 12);
const H = 3_600_000;
const bots = [{ id: "b1", name: "Atlas" }, { id: "b2", name: "Boreas" }];
const routine = (id: string, name: string, extra: Partial<Routine> = {}) =>
  ({ id, name, prompt: "x", target: "bot", botId: id === "r2" ? "b2" : "b1", runOn: "maus", enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: NOW + 2 * H, createdAt: 1, updatedAt: 1, canEdit: true, ...extra }) as Routine;
const run = (id: string, routineId: string, status: RoutineRun["status"], hoursAgo: number) =>
  ({ id, routineId, routineName: "n", botId: "b1", target: "bot", runOn: "maus", manual: false, scheduledFor: NOW - hoursAgo * H, createdAt: NOW - hoursAgo * H, startedAt: NOW - hoursAgo * H, finishedAt: NOW - hoursAgo * H + 120_000, status }) as RoutineRun;

let host: HTMLDivElement;
let root: Root;
const calls: string[] = [];
const mount = async (routines: Routine[], runs: RoutineRun[], extra: Record<string, unknown> = {}) => {
  await act(async () => {
    root.render(createElement(RoutinesOverview, {
      ...extra,
      routines, runs, bots: bots as never, now: NOW, filtersMenu: createElement("span", { "data-filters": "" }), newMenu: createElement("span", { "data-new": "" }),
      onOpen: (r: Routine) => { calls.push(`open:${r.id}`); },
      onOpenRun: (r: RoutineRun) => { calls.push(`run:${r.id}`); },
      onRowMenu: (r: Routine) => { calls.push(`menu:${r.id}`); },
      onFailedRuns: (period: string) => { calls.push(`failed:${period}`); },
    }));
  });
};
const text = (selector: string) => host.querySelector(selector)?.textContent ?? "";

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  calls.length = 0;
  reads.trend.length = 0;
  reads.from.length = 0;
  reads.covered = true;
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("RoutinesOverview", () => {
  const routines = [routine("r1", "Digest"), routine("r2", "Backup", { enabled: false, nextRunAt: null })];
  const runs = [run("a", "r1", "completed", 3), run("b", "r1", "completed", 27), run("c", "r1", "failed", 50), run("d", "r1", "nothing_to_report", 70)];

  it("shows the period's figures and a failed-runs button only when something failed", async () => {
    await mount(routines, runs);
    expect(text('[data-testid="routines-total"]')).toContain("4");
    expect(text('[data-testid="routines-rate"]')).toContain("75%");
    expect(text('[data-testid="routines-outcome"]')).toContain("3 succeeded");
    expect(text('[data-testid="routines-outcome"]')).toContain("of 4 runs");
    act(() => host.querySelector<HTMLButtonElement>("[data-routines-failed-runs]")!.click());
    expect(calls).toEqual(["failed:week"]);
    await mount(routines, runs.filter((r) => r.status !== "failed"));
    expect(host.querySelector("[data-routines-failed-runs]")).toBeNull();
    expect(text('[data-testid="routines-rate"]')).toContain("100%");
  });

  it("shows a dash, not 0%, when nothing ran in the period", async () => {
    await mount(routines, []);
    expect(text('[data-testid="routines-rate"]')).toContain("-");
    expect(text('[data-testid="routines-rate"]')).not.toContain("0%");
    expect(text('[data-testid="routines-outcome"]')).toContain("No runs yet");
  });

  it("draws one row per routine with its bot, its 7-run trend and its next run or a Paused chip", async () => {
    await mount(routines, runs);
    const rows = [...host.querySelectorAll("[data-routine-row]")];
    expect(rows.map((r) => r.getAttribute("data-routine-id"))).toEqual(["r1", "r2"]);
    expect(rows[0]!.querySelector("[data-routine-bot]")?.textContent).toBe("Atlas");
    expect(rows[0]!.querySelector("[data-routine-next]")).not.toBeNull();
    expect(rows[1]!.querySelector("[data-routine-state]")?.textContent).toBe("Paused");
  });

  it("draws the trend as 7 marks, oldest at the left, a colour per result, and says it in words", async () => {
    await mount(routines, runs);
    const trend = host.querySelector('[data-routine-id="r1"] [data-routine-trend]')!;
    const marks = [...trend.querySelectorAll("[data-trend-mark]")].map((mark) => mark.getAttribute("data-trend-mark"));
    expect(marks).toEqual(["empty", "empty", "empty", "success", "failed", "success", "success"]);
    expect(trend.getAttribute("aria-label")).toBe("Last 7 runs: 3 succeeded, 1 failed; most recent 3 h ago");
    expect(trend.querySelector("[data-trend-ago]")?.textContent).toBe("3 h ago");
    // seven bars of the same size (colour alone says the result), each in the skin's colour for it
    const bars = [...trend.querySelectorAll("[data-trend-mark]")] as HTMLElement[];
    expect(bars.every((bar) => bar.className.includes("h-4") && bar.className.includes("w-1"))).toBe(true);
    expect(bars.map((bar) => /bg-(trend-success|trend-failed|trend-problems|accent|ink)/.exec(bar.className)?.[1])).toEqual(["ink", "ink", "ink", "trend-success", "trend-failed", "trend-success", "trend-success"]);
    expect(trend.querySelector("svg")).toBeNull();
  });

  it("gives each mark its date, result and duration, and opens that run on a click", async () => {
    await mount(routines, runs);
    const failedMark = host.querySelector<HTMLButtonElement>('[data-routine-id="r1"] [data-trend-mark="failed"]')!;
    expect(failedMark.title).toMatch(/Failed/);
    expect(failedMark.title).toMatch(/2 min/);
    act(() => failedMark.click());
    expect(calls).toEqual(["run:c"]);
  });

  it("shows 7 faint empty bars and Not run yet for a routine that never ran", async () => {
    await mount(routines, runs);
    const trend = host.querySelector('[data-routine-id="r2"] [data-routine-trend]')!;
    expect([...trend.querySelectorAll("[data-trend-mark]")].every((mark) => mark.getAttribute("data-trend-mark") === "empty")).toBe(true);
    expect(trend.querySelectorAll("[data-trend-mark]")).toHaveLength(7);
    expect(trend.querySelector("[data-trend-ago]")?.textContent).toBe("Not run yet");
    expect(trend.getAttribute("aria-label")).toBe("Last 7 runs: none yet");
  });

  it("opens the routine from its name and its menu from the ... button, never for a read-only routine", async () => {
    await mount([...routines, routine("r3", "Shared", { canEdit: false })], runs);
    act(() => host.querySelector<HTMLButtonElement>('[data-routine-id="r1"] [data-routine-title]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-routine-id="r2"] [data-routine-row-menu]')!.click());
    expect(calls).toEqual(["open:r1", "menu:r2"]);
    expect(host.querySelector('[data-routine-id="r3"] [data-routine-row-menu]')).toBeNull();
  });

  it("searches the table and says when nothing matches", async () => {
    await mount(routines, runs);
    const input = host.querySelector<HTMLInputElement>("[data-routines-search]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "backup");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...host.querySelectorAll("[data-routine-row]")].map((r) => r.getAttribute("data-routine-id"))).toEqual(["r2"]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("No routine matches.");
  });

  it("draws a blocked, missed or waiting run as a full bar of the same size, colour only", async () => {
    const blocked = [run("a", "r1", "blocked", 5), run("b", "r1", "failed", 4), run("c", "r1", "missed", 3), run("d", "r1", "waiting", 2), run("e", "r1", "completed", 1)];
    await mount(routines, blocked);
    const bar = (kind: string) => host.querySelector<HTMLElement>(`[data-routine-id="r1"] [data-trend-mark="${kind}"]`)!;
    expect(bar("failed").className).toContain("bg-trend-failed");
    expect(bar("blocked").className).toContain("bg-trend-failed");
    expect(bar("waiting").className).toContain("bg-trend-problems");
    for (const kind of ["blocked", "waiting"]) expect(bar(kind).className).not.toMatch(/ring-inset|bg-transparent/);
    for (const kind of ["failed", "blocked", "waiting", "success"]) expect(bar(kind).className).toContain("h-4");
    // the meaning stays in words: the label and the sentence
    expect(bar("blocked").getAttribute("aria-label")).toMatch(/Blocked|Missed/);
    expect(host.querySelector('[data-routine-id="r1"] [data-routine-trend]')!.getAttribute("aria-label")).toContain("2 blocked or missed");
  });

  it("makes the trend one tab stop with the arrow keys moving between bars and Enter opening the run", async () => {
    await mount(routines, runs);
    const marks = [...host.querySelectorAll<HTMLElement>('[data-routine-id="r1"] [data-trend-run]')];
    expect(marks.map((mark) => mark.tabIndex)).toEqual([-1, -1, -1, 0]);
    act(() => marks[3]!.focus());
    act(() => { marks[3]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(document.activeElement).toBe(marks[2]);
    expect(marks.map((mark) => mark.tabIndex)).toEqual([-1, -1, 0, -1]);
    act(() => { marks[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
    expect(document.activeElement).toBe(marks[0]);
    act(() => { marks[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(calls).toEqual(["run:d"]);
  });

  it("puts the first words of what the run said in the bar's tooltip", async () => {
    const said = { ...run("p", "r1", "completed", 1), output: "Nine invoices sent, one waiting on a PO number." } as RoutineRun;
    await mount(routines, [said]);
    expect(host.querySelector<HTMLElement>('[data-routine-id="r1"] [data-trend-mark="success"]')!.title).toContain("Nine invoices sent");
  });

  it("says a suspended or auto-paused routine's reason as text in its Next run cell", async () => {
    const stopped = routine("r4", "Flaky", { enabled: false, nextRunAt: null, suspended: { reason: "usage_limit" } as never });
    await mount([...routines, stopped], runs);
    const state = host.querySelector('[data-routine-id="r4"] [data-routine-state]')!;
    expect(state.textContent).not.toBe("");
    expect(state.textContent).toBe(state.getAttribute("title"));
  });

  it("reads the trend once for the day, not again on each render or minute", async () => {
    await mount(routines, runs);
    await mount(routines, [...runs, run("z", "r1", "completed", 1)]);
    await mount(routines, runs, { now: NOW + 59 * 60_000 });
    expect(new Set(reads.trend.map(([start]) => start)).size).toBe(1);
    expect(reads.trend[0]![1]).toBe(7);
    expect(reads.trend[0]![0] % 86_400_000).toBe(0);
  });

  it("shows 30-day figures as loading until the older runs are in, never the 14 days already held", async () => {
    await mount(routines, runs);
    const choose = async (value: string) => {
      const select = host.querySelector<HTMLElement>('[aria-label="Period"]')!;
      await act(async () => { select.click(); });
      await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="option"], [role="menuitemradio"], button')].find((item) => item.textContent === value)?.click(); });
    };
    reads.covered = false;
    await choose("Last 30 days");
    expect(host.querySelector("[data-routines-figures-loading]")).not.toBeNull();
    expect(text('[data-testid="routines-total"]')).toContain("…");
    expect(host.querySelector("[data-routines-failed-runs]")).toBeNull();
    expect(reads.from.at(-1)).toBeLessThan(NOW);
    reads.covered = true;
    await mount(routines, runs);
    expect(host.querySelector("[data-routines-figures-loading]")).toBeNull();
    expect(text('[data-testid="routines-total"]')).toContain("4");
  });

  it("closes the narrow Group by menu on Escape and moves between its choices with the arrows", async () => {
    await mount(routines, runs, { onGroupBy: () => {} });
    const details = host.querySelector<HTMLDetailsElement>("[data-routines-group-menu]")!;
    details.setAttribute("open", "");
    const items = [...details.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    act(() => items[0]!.focus());
    act(() => { items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement).toBe(items[1]);
    act(() => { items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(details.hasAttribute("open")).toBe(false);
  });

  it("redraws only the row a run event changes, not the whole table", async () => {
    const three = [routine("r1", "Digest"), routine("r3", "Report"), routine("r4", "Sweep")];
    await mount(three, runs);
    expect(new Set(drawn.ids)).toEqual(new Set(["r1", "r3", "r4"]));
    drawn.ids.length = 0;
    // one new run for r1: the runs array and every row object are rebuilt, one row has anything new to draw
    await mount(three, [...runs, run("n", "r1", "completed", 1)]);
    expect(new Set(drawn.ids)).toEqual(new Set(["r1"]));
    drawn.ids.length = 0;
    await mount(three, [...runs, run("n", "r1", "completed", 1)]);
    expect(drawn.ids).toEqual([]);
  });
});
