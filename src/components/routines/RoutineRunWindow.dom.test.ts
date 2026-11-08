// @vitest-environment happy-dom
// #2272 (the owner, 2026-11-06: "I asked to be able to open the details of a
// routine. It should open the equivalent of a bot to bot chat ... It not
// doing anything when I click it. This is innacceptable."). Blocking: a click
// on View run (the chat's card, the bot panel's runs, the routine list, the
// report all go through openRoutineRun) draws the run's window over the chat
// column, the bot-to-bot exchange shell with its X; X closes it. A run older
// than the app's window is loaded by id, and its window opens all the same.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Message } from "@/state/store";

const apiMock = vi.fn();
const store = vi.hoisted(() => ({ state: null as unknown as AppState, dispatch: (_action: unknown) => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: (...args: unknown[]) => apiMock(...args),
    useStore: () => ({ state: store.state, dispatch: store.dispatch }),
  };
});
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: () => () => {} }));

const { initialState, openRoutineRun, reducer } = await import("@/state/store");
const { RoutineRunCard } = await import("@/components/RoutineRunCard");
const { ChatViewSheets } = await import("@/components/ChatView.tsx-parts/ChatViewSheets");

const bot = { ...initialState.bots[0], id: "scout", name: "Scout", color: "green", threadId: "main-chat", messages: [], tasks: [] } as never;
const routine = { id: "routine-1", name: "Project health watch", bot: { id: "scout", name: "Scout" } } as never;
const run = { id: "run-1", botId: "scout", routineId: "routine-1", routineName: "Project health watch", status: "completed", target: "bot", scheduledFor: 1, output: "All green." } as never;

function report(): Message {
  return {
    id: "report", role: "bot", kind: "routine.run", at: 1,
    routineRun: { runId: "run-1", routineId: "routine-1", routineName: "Project health watch", status: "completed", executionThreadId: "run-thread", summary: "All green." },
  };
}

let host: HTMLElement;
let root: Root;
function render() {
  flushSync(() => root.render(createElement("div", null,
    createElement(RoutineRunCard, { message: report(), onOpen: () => openRoutineRun(store.dispatch as (action: Action) => void, { runId: "run-1", routineId: "routine-1" }) }),
    createElement(ChatViewSheets, { state: { codingChat: null, routineRunWindow: store.state.routineRunWindow }, storeBots: [bot], dispatch: store.dispatch as (action: Action) => void }),
  )));
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(() => new Promise(() => {}));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  store.dispatch = (action) => { store.state = reducer(store.state, action as Action); render(); };
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("#2272 clicking a routine run opens its window", () => {
  it("View run draws the bot-to-bot window over the chat; X closes it", () => {
    store.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: [run], selectedId: "other", activeView: "routines" } as AppState;
    render();
    expect(host.querySelector('[data-testid="routine-run-window"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]')!.click();
    expect(store.state.activeView).toBe("chat");
    expect(store.state.selectedId).toBe("scout");
    const window = host.querySelector('[data-testid="routine-run-window"]');
    expect(window).not.toBeNull();
    expect(window!.textContent).toContain("Project health watch");
    expect(window!.textContent).not.toMatch(/Open thread|Go to conversation|Continue in the conversation/);
    // the routine run floats the bot chat's bar, pill and fades (the owner 2026-11-06)
    const bar = window!.querySelector<HTMLElement>("[data-chat-header-bar]")!;
    expect(bar.className).toMatch(/absolute inset-x-0 top-0/);
    expect(bar.querySelector('[data-chat-edge-fade="top"]')).not.toBeNull();
    expect(bar.querySelector("[data-chat-header-center] [data-chat-pill]")?.className).toMatch(/h-10/);
    expect(window!.querySelector('[data-chat-bottom-edge] [data-chat-edge-fade="bottom"]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[data-testid="bot-exchange-close"]')!.click();
    expect(store.state.routineRunWindow).toBeNull();
    expect(host.querySelector('[data-testid="routine-run-window"]')).toBeNull();
  });

  it("a run the app has not loaded opens its window and is fetched by id", async () => {
    store.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: [], selectedId: "scout" } as AppState;
    apiMock.mockImplementation((path: string) => path.startsWith("/api/routines?run=") ? Promise.resolve({ runs: [run] }) : new Promise(() => {}));
    render();
    host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]')!.click();
    expect(host.querySelector('[data-testid="routine-run-window"]')).not.toBeNull();
    expect(apiMock).toHaveBeenCalledWith("/api/routines?run=run-1");
    await vi.waitFor(() => expect(store.state.routineRuns.map((candidate) => candidate.id)).toEqual(["run-1"]));
    expect(host.querySelector('[data-testid="routine-run-window"]')).not.toBeNull();
  });
});
