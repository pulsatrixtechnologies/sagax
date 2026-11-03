// @vitest-environment happy-dom
// 2026-11-02 (calendar performance): a live run frame and an unrelated store
// frame must not render the calendar's cards again. Before, every frame drew
// every card (and its bot avatar) of the week; the benchmark is
// scripts/perf/automations-calendar-bench.mjs.
import { act, createElement, useReducer, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ avatarRenders: 0 }));
vi.mock("@/hooks/use-modal-dialog", () => ({ useModalDialog: () => {} }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/components/Avatar", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/Avatar")>(),
  BotAvatar: () => { fixture.avatarRenders += 1; return null; },
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(async () => ({ calls: [] })),
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));

const { RoutinesPage } = await import("./RoutineCalendarPage");
const { ConfirmProvider } = await import("@/components/ConfirmProvider");
const { BotEditorStore, initialState } = await import("@/state/store");
const { reducer } = await import("@/state/store/reducer");
type AppState = import("@/state/store").AppState;
type Action = import("@/state/store/model").Action;
type Routine = import("@/lib/routines").Routine;
type RoutineRun = import("@/lib/routines").RoutineRun;

const bot = { id: "atlas", threadId: "atlas-thread", name: "Atlas", title: "", description: "", color: "blue", notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "test" } } as unknown as import("@/state/store").Bot;
const routines = Array.from({ length: 4 }, (_, index) => ({
  id: `r${index}`, botId: "atlas", name: `Routine ${index}`, prompt: "Report.", target: "bot", runOn: "maus", enabled: true, durationMinutes: 30, timeoutMinutes: 45, createdAt: 1, updatedAt: 1, canRun: true, canEdit: true,
  schedule: { type: "daily", time: `${String(8 + index * 2).padStart(2, "0")}:00`, weekdays: [0, 1, 2, 3, 4, 5, 6] }, nextRunAt: Date.now() + 3_600_000,
})) as unknown as Routine[];
const running = { id: "run-1", routineId: "r0", routineName: "Routine 0", prompt: "Report.", botId: "atlas", target: "bot", runOn: "maus", status: "running", manual: false, scheduledFor: Date.now() - 60_000, createdAt: Date.now() - 60_000, startedAt: Date.now() - 50_000, timeoutMinutes: 45 } as unknown as RoutineRun;
const start: AppState = reducer({ ...initialState, bots: [bot], routinesFocus: { section: "schedule", view: "calendar", nonce: 1 } } as AppState, { type: "routinesHydrated", routines, runs: [running] });

let send: (action: Action) => void = () => {};
function Host({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, start);
  send = dispatch;
  return createElement(BotEditorStore, { value: { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children });
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  fixture.avatarRenders = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const onBack = () => {};
const onOpenRoom = () => {};

describe("Automations calendar under live frames", () => {
  it("renders no card again for a run frame or an unrelated store frame", async () => {
    await act(async () => {
      root.render(createElement(ConfirmProvider, null, createElement(Host, null, createElement(RoutinesPage, { fill: true, onBack, onOpenRoom }))));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const cards = container.querySelectorAll("[data-event-card]").length;
    expect(cards).toBeGreaterThan(0);
    const avatarsAfterMount = fixture.avatarRenders;
    expect(avatarsAfterMount).toBeGreaterThan(0);

    for (let step = 1; step <= 5; step += 1) {
      act(() => send({ type: "routineRunPatched", run: { ...running, attention: `Step ${step}` } as RoutineRun }));
      act(() => send({ type: "sidebarHidden", keys: new Set([`row-${step}`]) }));
    }
    // The header still follows the runs: the run indicator counts the live one.
    expect(container.querySelector("[data-automations-running]")?.textContent).toContain("1");
    expect(container.querySelectorAll("[data-event-card]").length).toBe(cards);
    expect(fixture.avatarRenders).toBe(avatarsAfterMount);

    // A routine that changes redraws its own cards only.
    act(() => send({ type: "routinePatched", routine: { ...routines[1]!, name: "Renamed" } as Routine }));
    const renamed = [...container.querySelectorAll("[data-event-card]")].filter((card) => card.textContent?.includes("Renamed")).length;
    expect(renamed).toBeGreaterThan(0);
    expect(fixture.avatarRenders - avatarsAfterMount).toBe(renamed);
  });
});
