// @vitest-environment happy-dom
// The Routines page's Overview (2026-11-17): the Runs figures and the table
// with its row actions. Figures are tested in src/lib/routine-figures.test.ts.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";

vi.mock("@/state/older-routine-runs", () => ({ useRoutineRunsFrom: () => {} }));
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
const mount = async (routines: Routine[], runs: RoutineRun[]) => {
  await act(async () => {
    root.render(createElement(RoutinesOverview, {
      routines, runs, bots: bots as never, now: NOW, filtersMenu: createElement("span", { "data-filters": "" }), newMenu: createElement("span", { "data-new": "" }),
      onOpen: (r: Routine) => { calls.push(`open:${r.id}`); },
      onRowMenu: (r: Routine) => { calls.push(`menu:${r.id}`); },
      onFailedRuns: () => { calls.push("failed"); },
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
    expect(calls).toEqual(["failed"]);
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

  it("draws one row per routine with its bot, last run and next run or Paused", async () => {
    await mount(routines, runs);
    const rows = [...host.querySelectorAll("[data-routine-row]")];
    expect(rows.map((r) => r.getAttribute("data-routine-id"))).toEqual(["r1", "r2"]);
    expect(rows[0]!.querySelector("[data-routine-bot]")?.textContent).toBe("Atlas");
    expect(rows[0]!.querySelector("[data-routine-last-run]")?.getAttribute("data-routine-last-run")).toBe("completed");
    expect(rows[0]!.querySelector("[data-routine-next]")).not.toBeNull();
    expect(rows[1]!.querySelector("[data-routine-state]")?.textContent).toBe("Paused");
    expect(rows[1]!.querySelector("[data-routine-last-run]")?.getAttribute("data-routine-last-run")).toBe("none");
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
});
