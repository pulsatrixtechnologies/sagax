// @vitest-environment happy-dom
// [M-20261125-040] (the owner, 2026-11-25, on a routine run's window: "Peux
// tu éviter de mettre le chat et remettre le close button et un bouton
// Continue in a chat et retire le X d'en haut du chat"). The run's window is
// the bot-to-bot sheet again, as before 0.8.52 (#2149 had given it the X and
// left the chat's message bar under it): it covers the message bar, has no
// X, and ends on one row, Continue in the conversation then Close Chat.
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Message } from "@/state/store";
import type { WaitingItem } from "@/lib/use-waiting-cards";

const store = vi.hoisted(() => ({ state: null as unknown as AppState, actions: [] as unknown[] }));
const activity = vi.hoisted(() => ({ waiting: [] as unknown[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: () => new Promise(() => {}),
    useStore: () => ({ state: store.state, dispatch: (action: unknown) => { store.actions.push(action); } }),
  };
});
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: () => () => {} }));
vi.mock("./RunActivityState", () => ({
  RunActivityState: ({ children }: { children: (value: unknown) => ReactNode }) =>
    children({ detail: null, error: false, reload: async () => {}, waiting: activity.waiting }),
}));
vi.mock("../OptionCard", () => ({
  OptionCard: (props: { message: Message }) => createElement("div", { "data-test-option-card": props.message.id }),
}));

const { initialState } = await import("@/state/store");
const { loadLocale, setLocale } = await import("@/lib/i18n");
const { createPinnedHold, PinnedHoldContext } = await import("@/lib/pinned-waiting");
const { ChatWindowProvider } = await import("../BotHeaderPill");
const { RoutineRunWindow } = await import("./RoutineRunWindow");

const report: Message = {
  id: "report", role: "bot", kind: "routine.run", at: 1,
  routineRun: { runId: "run-1", routineId: "routine-1", routineName: "Project health watch", status: "completed", executionThreadId: "run-thread", summary: "All green." },
} as Message;
const bot = { ...initialState.bots[0], id: "scout", name: "Scout", color: "green", threadId: "main-chat", mainThreadId: "main-chat", messages: [report], tasks: [] } as never;
const routine = { id: "routine-1", name: "Project health watch", bot: { id: "scout", name: "Scout" } } as never;
const run = (patch: Record<string, unknown> = {}) => ({ id: "run-1", botId: "scout", routineId: "routine-1", routineName: "Project health watch", status: "completed", target: "bot", scheduledFor: 1, output: "All green.", resultsThreadId: "main-chat", ...patch }) as never;

let host: HTMLElement;
let root: Root;
const onClose = vi.fn();
function draw(runs: unknown[], wrap: (node: ReactNode) => ReactNode = (node) => node) {
  store.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: runs, selectedId: "scout" } as AppState;
  flushSync(() => root.render(wrap(createElement(RoutineRunWindow, { target: { runId: "run-1" }, bots: [bot], onClose, onStop: () => {} }))));
  return host.querySelector<HTMLElement>('[data-testid="routine-run-window"]')!;
}
const footerWords = (window: HTMLElement) => [...window.querySelectorAll("[data-exchange-footer] button")].map((button) => button.textContent);

beforeAll(() => setLocale("en"));
beforeEach(() => {
  store.actions.length = 0;
  activity.waiting = [];
  onClose.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("a routine run's window is the bot-to-bot sheet [M-20261125-040]", () => {
  it("covers the chat's message bar and stays open when the chat sends", () => {
    const inChat = (sentKey: string) => (node: ReactNode) => createElement(ChatWindowProvider, { value: { panelOpen: false, onTogglePanel: () => {}, composerInset: 96, sentKey }, children: node });
    const window = draw([run()], inChat("u1"));
    expect(window.getAttribute("data-exchange-chrome")).toBe("sheet");
    expect(window.className).toMatch(/\binset-0\b/);
    expect(window.style.bottom).toBe("");
    draw([run()], inChat("u2"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has no X at the top; the Close Chat pill at the bottom closes it", () => {
    const window = draw([run()]);
    expect(window.querySelector("[data-window-close]")).toBeNull();
    expect(window.querySelector("[data-chat-header-bar]")).toBeNull();
    const close = window.querySelector<HTMLButtonElement>("button[data-exchange-close-chat]")!;
    expect(close.textContent).toBe("Close Chat");
    expect(footerWords(window).at(-1)).toBe("Close Chat");
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Continue in the conversation opens the bot's conversation on the report and closes the window", () => {
    const window = draw([run()]);
    expect(footerWords(window)).toEqual(["Continue in the conversation", "Close Chat"]);
    window.querySelector<HTMLButtonElement>("button[data-run-continue]")!.click();
    expect(store.actions as Action[]).toContainEqual({ type: "focusMessage", threadId: "main-chat", messageId: "report" });
    expect((store.actions as Action[]).some((action) => "threadId" in action && action.threadId === "run-thread")).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a run still going keeps the same row", () => {
    expect(footerWords(draw([run({ status: "running", output: undefined })]))).toEqual(["Continue in the conversation", "Close Chat"]);
  });

  it("a run that is not a bot's own (a team goal) has the Close Chat pill alone", () => {
    const window = draw([run({ target: "room-goal" })]);
    expect(window.querySelector("[data-run-continue]")).toBeNull();
    expect([...window.querySelectorAll("button[data-exchange-close-chat]")].map((button) => button.textContent)).toEqual(["Close Chat"]);
  });

  it("says Continuer dans la conversation and Fermer la conversation in French", async () => {
    await loadLocale("fr");
    try {
      expect(footerWords(draw([run()]))).toEqual(["Continuer dans la conversation", "Fermer la conversation"]);
    } finally {
      setLocale("en");
    }
  });

  // The sheet covers the chat's message bar and the pinned card over it:
  // an ask that card holds is drawn here, or it would be on screen nowhere.
  it("draws what the run waits on even when the chat's pinned card, now covered, holds it", () => {
    const question = { id: "q1", role: "bot", kind: "options", at: 1_000, text: "", from: { botId: "scout", name: "Scout", color: "green" },
      card: { title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question", questionRequest: { version: 1, questions: [{ question: "Which board?", options: [{ label: "Help desk" }] }] } } } as unknown as Message;
    activity.waiting = [{ kind: "question", message: question, threadId: "run-thread", botId: "scout" } satisfies WaitingItem];
    const chat = createPinnedHold();
    chat.set(new Set(["q1"]));
    const window = draw([run({ status: "waiting" })], (node) => createElement(PinnedHoldContext, { value: chat }, node));
    expect(window.querySelector('[data-run-waiting] [data-test-option-card="q1"]')).not.toBeNull();
    chat.set(new Set());
  });
});
