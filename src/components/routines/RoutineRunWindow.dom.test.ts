// @vitest-environment happy-dom
// #2272 (the owner, 2026-11-06: "I asked to be able to open the details of a
// routine. It should open the equivalent of a bot to bot chat ... It not
// doing anything when I click it. This is innacceptable."). Blocking: a click
// on View run (the chat's card, the bot panel's runs, the routine list, the
// report all go through openRoutineRun) draws the run's window over the chat
// column, the bot-to-bot exchange shell. A run older than the app's window
// is loaded by id, and its window opens all the same.
// [M-20261125-040] (the owner, 2026-11-25, on a routine run's window: "Peux
// tu éviter de mettre le chat et remettre le close button et un bouton
// Continue in a chat et retire le X d'en haut du chat"): the window covers
// the chat's message bar, has no X at the top, and ends on one row: Continue
// in the conversation, then the Close Chat pill, as before 0.8.52.
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
const { t } = await import("@/lib/i18n");
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
  it("View run draws the bot-to-bot sheet over the chat: no X, no message bar, Close Chat closes it [M-20261125-040]", () => {
    store.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: [run], selectedId: "other", activeView: "routines" } as AppState;
    render();
    expect(host.querySelector('[data-testid="routine-run-window"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]')!.click();
    expect(store.state.activeView).toBe("chat");
    expect(store.state.selectedId).toBe("scout");
    const window = host.querySelector<HTMLElement>('[data-testid="routine-run-window"]');
    expect(window).not.toBeNull();
    expect(window!.textContent).toContain("Project health watch");
    expect(window!.textContent).not.toMatch(/Open thread|Go to conversation/);
    // no X at the top, no floating bar of the chat
    expect(window!.querySelector("[data-window-close]")).toBeNull();
    expect(window!.querySelector("[data-chat-header-bar]")).toBeNull();
    // the pill is the one chat pill, 40px: the reference's measure in the
    // owner's configuration (a 24px mascot, 7.5px around it, a 0.5px ring; #4163)
    expect(window!.querySelector("[data-exchange-header] [data-chat-pill]")?.className).toMatch(/\bh-10\b/);
    // the sheet covers the whole column, the chat's message bar included
    expect(window!.getAttribute("data-exchange-chrome")).toBe("sheet");
    expect(window!.className).toMatch(/\binset-0\b/);
    expect(window!.style.bottom).toBe("");
    // one footer row: Continue first, the Close Chat pill last
    const row = window!.querySelector<HTMLElement>("[data-exchange-footer]")!;
    const buttons = [...row.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Continue in the conversation", "Close Chat"]);
    expect(buttons[0]!.hasAttribute("data-run-continue")).toBe(true);
    expect(buttons[1]!.hasAttribute("data-exchange-close-chat")).toBe(true);
    buttons[1]!.click();
    expect(store.state.routineRunWindow).toBeNull();
    expect(host.querySelector('[data-testid="routine-run-window"]')).toBeNull();
  });

  // #3581: the chat's card shows two lines; its Details opens the whole
  // report, read by id, never the record's 2,000 characters.
  it("Details opens the whole report, read by id", async () => {
    const whole = `${"Line of the report. ".repeat(200)}Closing line of the whole report.`;
    store.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: [{ ...(run as object), output: whole.slice(0, 2_000) }], selectedId: "scout" } as unknown as AppState;
    apiMock.mockImplementation((path: string) => path.startsWith("/api/routines?run=") ? Promise.resolve({ runs: [{ ...(run as object), output: whole.slice(0, 2_000), report: whole }] }) : new Promise(() => {}));
    render();
    host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]')!.click();
    expect(apiMock).toHaveBeenCalledWith("/api/routines?run=run-1");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="routine-run-window"]')?.textContent).toContain("Closing line of the whole report."));
  });

  // #3581 (review): the card shows two lines, so its Details must open the
  // whole report even when the run's record is gone (the run log trimmed) or
  // its task thread deleted: the window falls back to the card's own report.
  const cardReport = `${"Paragraph of the whole report. ".repeat(120)}Closing line kept only by the card.`;
  function openFromCard() {
    flushSync(() => root.render(createElement("div", null,
      createElement(RoutineRunCard, { message: { ...report(), routineRun: { ...report().routineRun!, summary: cardReport } }, onOpen: () => openRoutineRun(store.dispatch as (action: Action) => void, { runId: "run-1", routineId: "routine-1", report: { text: cardReport, at: 1 } }) }),
      createElement(ChatViewSheets, { state: { codingChat: null, routineRunWindow: store.state.routineRunWindow }, storeBots: [bot], dispatch: store.dispatch as (action: Action) => void }),
    )));
    store.dispatch = (action) => { store.state = reducer(store.state, action as Action); openFromCard(); };
  }

  it("a card whose run is not found by id still shows its whole report after Details", async () => {
    store.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: [], selectedId: "scout" } as AppState;
    apiMock.mockImplementation((path: string) => path.startsWith("/api/routines?run=") ? Promise.resolve({ runs: [] }) : new Promise(() => {}));
    openFromCard();
    host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]')!.click();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="routine-run-window"]')?.textContent).toContain("Closing line kept only by the card."));
    expect(host.querySelector('[data-testid="routine-run-window"]')?.textContent).not.toContain(t("chat.exchange.loadError"));
  });

  it("a run whose record holds less than its card shows the card's report, without asking the server", async () => {
    store.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: [{ ...(run as object), output: cardReport.slice(0, 1_990) + "…" }], selectedId: "scout" } as unknown as AppState;
    openFromCard();
    host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]')!.click();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="routine-run-window"]')?.textContent).toContain("Closing line kept only by the card."));
    expect(apiMock.mock.calls.some(([path]) => String(path).startsWith("/api/routines?run="))).toBe(false);
  });

  it("a whole short report is never asked for again", () => {
    store.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: [run], selectedId: "scout" } as AppState;
    render();
    host.querySelector<HTMLButtonElement>('button[aria-label="View run for Project health watch"]')!.click();
    expect(host.querySelector('[data-testid="routine-run-window"]')?.textContent).toContain("All green.");
    expect(apiMock.mock.calls.some(([path]) => String(path).startsWith("/api/routines?run="))).toBe(false);
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
