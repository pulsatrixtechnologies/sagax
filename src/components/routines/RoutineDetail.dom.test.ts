// @vitest-environment happy-dom
// A routine's page (2026-11-03, JC): the Trigger value opens the trigger
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
const { RoutineDetail, RoutineStateBadge, RoutineStatusRows, clearRoutineRuns } = await import("./RoutineDetail");

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

describe("the side panel's status rows (2026-11-06, JC)", () => {
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
