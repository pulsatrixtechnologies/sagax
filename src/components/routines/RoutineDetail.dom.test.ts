// @vitest-environment happy-dom
// A routine's page (2026-11-03, the owner): the Trigger value opens the trigger
// popover (the app's AnchoredPopover, no native control) and saves on Apply;
// Active switches in place; "Runs (n)" has Clear run logs, asked first, which
// clears only this routine's runs.
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";

const fixture = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async (path: string, init?: { method?: string }) => {
      fixture.calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path.startsWith("/api/routine-runs?") && init?.method === "DELETE") return { ok: true, removed: ["run-1", "run-2"] };
      return {};
    }),
    useStore: () => ({ state: { ...original.initialState, webhooks: [], webhookIngress: { available: true, baseUrl: "https://hooks.example.test" } }, dispatch: vi.fn() }),
  };
});

const { setLocale } = await import("@/lib/i18n");
const { ConfirmProvider, useConfirm } = await import("@/components/ConfirmProvider");
const routineDetail = await import("./RoutineDetail");
const { RoutineDetail, RoutineLastRun, RoutineRunsByDay, RoutineRunsSection, RoutineStateBadge, RoutineStatusRows, clearRoutineRuns } = routineDetail;

const bot = { id: "runner", threadId: "main", name: "Runner", color: "green", tasks: [] } as unknown as Bot;
const routine = {
  id: "r1", name: "Brief and afternoon check", prompt: "Check.", target: "bot", botId: bot.id, runOn: "maus", enabled: true, canEdit: true,
  schedule: { type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" }, durationMinutes: 30, nextRunAt: Date.now() + 3_600_000, createdAt: 1, updatedAt: 1,
} as unknown as Routine;
const runs = [1, 2].map((index) => ({ id: `run-${index}`, routineId: "r1", routineName: routine.name, botId: bot.id, target: "bot", status: "completed", scheduledFor: Date.now() - index * 3_600_000, runOn: "maus" })) as unknown as RoutineRun[];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  fixture.calls = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

function Page({ onPatch, onToggle, dispatch }: { onPatch: (patch: unknown) => Promise<void>; onToggle: () => void; dispatch: (action: unknown) => void }) {
  const confirm = useConfirm();
  return createElement(RoutineDetail, { routine, runs, bots: [bot], onOpenRun: () => {}, onToggle, onPatch, onClearRuns: () => void clearRoutineRuns(routine, confirm, dispatch) });
}
const mount = () => {
  const onPatch = vi.fn(async (_patch: unknown) => {});
  const onToggle = vi.fn();
  const dispatch = vi.fn();
  flushSync(() => root.render(createElement(ConfirmProvider, null, createElement(Page, { onPatch, onToggle, dispatch }))));
  return { onPatch, onToggle, dispatch };
};

describe("a routine's page", () => {
  it("changes the trigger in a popover: frequency, times, then Apply saves the new schedule", async () => {
    const { onPatch } = mount();
    expect(host.querySelector("[data-routine-state]")).toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>("button[data-routine-trigger]")!;
    flushSync(() => trigger.click());
    const popover = document.querySelector<HTMLElement>("[data-routine-trigger-popover]")!;
    expect(popover).not.toBeNull();
    expect(popover.getAttribute("role")).toBe("dialog");
    expect(document.querySelectorAll("select").length).toBe(0);
    // Weekdays at 8:30 today; make it every day with a second time.
    flushSync(() => popover.querySelector<HTMLButtonElement>("button[data-pill-select][aria-label='Repeat']")!.click());
    flushSync(() => [...document.querySelectorAll<HTMLElement>("[role=option]")].find((option) => option.textContent === "Every day")!.click());
    flushSync(() => popover.querySelector<HTMLButtonElement>("[data-schedule-add-time]")!.click());
    expect(popover.querySelector("[data-schedule-zone-row]")).not.toBeNull();
    expect(onPatch).not.toHaveBeenCalled();
    await act(async () => { popover.querySelector<HTMLButtonElement>("[data-trigger-apply]")!.click(); });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch.mock.calls[0]![0]).toMatchObject({ schedule: { type: "cron", expression: "30 8,12 * * *", timeZone: "America/Toronto" } });
    expect(document.querySelector("[data-routine-trigger-popover]")).toBeNull();
  });

  it("Active switches the routine in place", () => {
    const { onToggle } = mount();
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-routine-active] [role=switch]")!.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("Clear run logs asks, then clears this routine's own runs only", async () => {
    const { dispatch } = mount();
    const clear = host.querySelector<HTMLButtonElement>("[data-routine-clear-runs]")!;
    expect(clear.getAttribute("aria-label")).toBe("Clear run logs");
    await act(async () => { clear.click(); });
    expect(document.getElementById("confirm-dialog-title")?.textContent).toBe("Clear the run logs of “Brief and afternoon check”?");
    await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent === "Cancel" && button.closest("[role=alertdialog]"))!.click(); });
    expect(fixture.calls.some((call) => call.startsWith("DELETE"))).toBe(false);
    await act(async () => { clear.click(); });
    await act(async () => { (document.querySelector("[data-confirm-action]") as HTMLButtonElement).click(); });
    expect(fixture.calls).toContain("DELETE /api/routine-runs?scope=mine&routineId=r1");
    expect(dispatch).toHaveBeenCalledWith({ type: "routineRunsRemoved", ids: ["run-1", "run-2"] });
  });
});

describe("the side panel's status rows (2026-11-06, the owner)", () => {
  const readiness = { checking: false, error: "", answer: null, check: () => {} } as never;
  it("drops Runs as, the Active toggle and This week when the page asks", () => {
    const weekly = { ...routine, weekRuns: { ok: 2, total: 3 } } as unknown as Routine;
    flushSync(() => root.render(createElement(RoutineStatusRows, { routine: weekly, runs, readiness, onToggle: () => {}, runAs: false, active: false, week: false })));
    expect(host.querySelector("[data-routine-active]")).toBeNull();
    expect(host.querySelector("[data-routine-week-runs]")).toBeNull();
    expect(host.textContent).not.toContain("Runs as");
    expect(host.querySelector("[data-routine-next]")).not.toBeNull();
  });
  it("shows Failing as a badge, nothing when all is well", () => {
    flushSync(() => root.render(createElement(RoutineStateBadge, { routine: { ...routine, failureStreak: 2 } as unknown as Routine, runs: [] })));
    expect(host.querySelector("[data-routine-state-badge=warning]")?.textContent).toBe("Failing");
    flushSync(() => root.render(createElement(RoutineStateBadge, { routine, runs: [] })));
    expect(host.querySelector("[data-routine-state-badge]")).toBeNull();
  });
});

describe("the routine page's runs (#4357)", () => {
  const now = new Date(2026, 10, 14, 21, 0).getTime();
  const at = (daysAgo: number, hour: number) => new Date(2026, 10, 14 - daysAgo, hour, 15).getTime();
  const history = [
    { id: "a", status: "completed", scheduledFor: at(0, 20), startedAt: at(0, 20), finishedAt: at(0, 20) + 300_000, output: "All quiet today." },
    { id: "b", status: "failed", scheduledFor: at(0, 8), error: "The board did not answer." },
    { id: "c", status: "completed", scheduledFor: at(1, 20), cost: 0.12 },
    { id: "d", status: "completed", scheduledFor: at(3, 20), manual: true },
    { id: "other", routineId: "r2", status: "completed", scheduledFor: at(0, 9) },
  ].map((run) => ({ routineId: "r1", routineName: routine.name, botId: bot.id, target: "bot", runOn: "maus", ...run })) as unknown as RoutineRun[];

  it("groups every run of this routine by day, newest first, one line each with the coloured clock; a click opens the run", () => {
    const onOpenRun = vi.fn();
    const onClearRuns = vi.fn();
    flushSync(() => root.render(createElement(RoutineRunsByDay, { routine, runs: history, now, onOpenRun, onClearRuns })));
    const days = [...host.querySelectorAll("[data-routine-runs-day]")];
    expect(days.map((group) => group.querySelector("h3")?.textContent)).toEqual(["Today", "Yesterday", expect.any(String)]);
    expect(days.map((group) => [...group.querySelectorAll("[data-run-row]")].map((row) => row.getAttribute("data-run-row")))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(host.querySelector("[data-run-row=other]")).toBeNull();
    expect(host.querySelector("[data-run-row=a] [data-routine-clock]")?.getAttribute("data-routine-clock")).toBe("neutral");
    expect(host.querySelector("[data-run-row=b] [data-routine-clock]")?.getAttribute("data-routine-clock")).toBe("danger");
    expect(host.querySelector("[data-run-row=a]")!.textContent).toContain("5 min");
    expect(host.querySelector("[data-run-row=a] [data-run-row-preview]")?.textContent).toBe("All quiet today.");
    expect(host.querySelector("[data-run-row=c]")!.textContent).toContain("$0.12");
    expect(host.querySelector("[data-run-row=d]")!.textContent).toContain("Manual");
    // Clear run logs once, at the top right; the count is the tab's.
    expect(host.querySelectorAll("[data-routine-clear-runs]").length).toBe(1);
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-run-row=c]")!.click());
    expect(onOpenRun).toHaveBeenCalledWith(expect.objectContaining({ id: "c" }));
  });

  it("one run row for every list: the side panel's history and the page's lines give a run the same words, unread dot and click (nothing in double)", () => {
    expect("RoutineRunLine" in routineDetail).toBe(false);
    const onOpenRun = vi.fn();
    flushSync(() => root.render(createElement(RoutineRunsSection, { routine, runs: history, now, onOpenRun })));
    const panelRow = host.querySelector<HTMLButtonElement>("[data-run-row=b]")!;
    const panelLabel = panelRow.getAttribute("aria-label");
    expect(panelLabel).toContain("Unseen failure");
    expect(panelRow.querySelector("[data-run-row-label]")).not.toBeNull();
    flushSync(() => root.render(createElement(RoutineRunsByDay, { routine, runs: history, now, onOpenRun })));
    const pageRow = host.querySelector<HTMLButtonElement>("[data-run-row=b]")!;
    expect(pageRow.getAttribute("aria-label")).toBe(panelLabel);
    expect(pageRow.querySelector("[data-run-row-label]")).toBeNull();
    expect(pageRow.querySelector(".bg-danger.rounded-full")).not.toBeNull();
    flushSync(() => pageRow.click());
    expect(onOpenRun).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  it("Last run: the newest run on one line, how long ago; nothing before a first run", () => {
    flushSync(() => root.render(createElement(RoutineLastRun, { routine, runs: history, now, onOpenRun: () => {} })));
    const rows = host.querySelectorAll("[data-routine-last-run] [data-run-row]");
    expect(rows.length).toBe(1);
    expect(rows[0]!.getAttribute("data-run-row")).toBe("a");
    expect(host.querySelector("[data-routine-last-run] h3")?.textContent).toBe("Last run");
    flushSync(() => root.render(createElement(RoutineLastRun, { routine, runs: [], now, onOpenRun: () => {} })));
    expect(host.querySelector("[data-routine-last-run]")).toBeNull();
  });

  it("the page's status rows leave Au nom de to Settings (set once)", () => {
    const readiness = { checking: false, error: "", answer: null, check: () => {} } as never;
    const acting = { ...routine, actAs: "ops" } as unknown as Routine;
    flushSync(() => root.render(createElement(RoutineStatusRows, { routine: acting, runs, readiness, runAs: false, active: false, week: false })));
    expect(host.querySelector("[data-routine-act-as]")).not.toBeNull();
    flushSync(() => root.render(createElement(RoutineStatusRows, { routine: acting, runs, readiness, runAs: false, actAs: false, active: false, week: false })));
    expect(host.querySelector("[data-routine-act-as]")).toBeNull();
    expect(host.querySelector("[data-routine-next]")).not.toBeNull();
  });
});
