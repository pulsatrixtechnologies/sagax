// @vitest-environment happy-dom
// #4204, the owner's rule (2026-11-13): a team bot's pending question was
// drawn twice in a task's window over the chat: a "Waiting on you" card over
// the transcript with its options, and the pinned card over the window's own
// composer with the same words and options. The window draws it once, on its
// pinned card. And the window's composer has its own hold: it never writes
// into the chat's, so the chat under it keeps leaving its own pinned asks
// out of its conversation while the window is open and after it closes.
import { createElement, use, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import type { BotActivityDetail, BotActivityItem } from "../../../shared/bot-activity";
import { setExchangeColumnHost } from "@/lib/exchange-column-host";
import { setCodingPanelHost } from "@/lib/coding-panel-host";
import { createPinnedHold, PinnedHoldContext } from "@/lib/pinned-waiting";

const apiMock = vi.fn();
const fixture = vi.hoisted(() => ({ pinned: new Set<string>() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: (...args: unknown[]) => apiMock(...args),
    useStore: () => ({ state: { ...original.initialState, bots: [bot], groups: [], config: { viewer: { principalId: "person-1" } } }, dispatch: vi.fn() }),
    useStoreOptional: () => ({ state: { ...original.initialState, config: {} }, dispatch: vi.fn() }),
  };
});
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: () => () => {} }));
// The window's composer pins what the server lists for its bot (its own
// tests cover how); here it tells its view what its pinned card holds, as
// the real one does (usePublishPinnedHold).
vi.mock("../Composer", async () => {
  const { PinnedHoldContext: Context } = await import("@/lib/pinned-waiting");
  return {
    Composer: (props: { bot: Bot }) => {
      const hold = use(Context);
      useLayoutEffect(() => {
        hold?.set(new Set(fixture.pinned));
        return () => hold?.set(new Set());
      }, [hold]);
      return createElement("div", { "data-test-composer": props.bot.threadId });
    },
  };
});
vi.mock("../dev-pods/DevPods", () => ({ DevPodsPanel: () => null }));
vi.mock("../OptionCard", () => ({
  OptionCard: (props: { message: Message }) => createElement("div", { "data-test-option-card": props.message.id }),
}));

const { setLocale } = await import("@/lib/i18n");
const { CodingChat } = await import("./CodingChat");

const NOW = Date.UTC(2026, 10, 13, 15, 0);
const bot = { id: "scout", threadId: "main", name: "Scout", color: "green", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;
const from = { botId: "scout", name: "Scout", color: "green" as const };
const messages: Message[] = [
  { id: "m1", role: "user", kind: "text", text: "Sort the board", at: NOW - 60_000 },
  { id: "m2", role: "bot", kind: "text", text: "One thing first.", at: NOW - 50_000, from },
  {
    id: "q1", role: "bot", kind: "options", at: NOW - 40_000, text: "", from,
    card: { title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question", questionRequest: { version: 1, questions: [{ question: "Which board?", options: [{ label: "Help desk" }, { label: "Projects" }] }] } },
  } as unknown as Message,
];
const item: BotActivityItem = { id: "thread:th-1", kind: "session", botId: "scout", botName: "Scout", title: "Sort the board", status: "waiting", startedAt: NOW - 70_000, updatedAt: NOW, threadId: "th-1", coding: true };
const detail: BotActivityDetail = { ...item, steps: [], stepsTruncated: false, files: [], children: [], canStop: false } as BotActivityDetail;

let host: HTMLDivElement;
let column: HTMLDivElement;
let panel: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  apiMock.mockReset();
  apiMock.mockImplementation(async (url: string) => {
    if (url.includes("/activity/item")) return { item: detail };
    if (url.startsWith("/api/threads/th-1/messages")) return { messages, hasMore: false };
    return {};
  });
  host = document.createElement("div");
  column = document.createElement("div");
  host.append(column);
  document.body.append(host);
  setExchangeColumnHost(column);
  panel = document.createElement("div");
  document.body.append(panel);
  setCodingPanelHost("scout", panel);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  setExchangeColumnHost(null);
  setCodingPanelHost("scout", null);
  panel.remove();
  host.remove();
});

const open = (chat: ReturnType<typeof createPinnedHold>) => {
  flushSync(() => root.render(createElement(PinnedHoldContext, { value: chat },
    createElement(CodingChat, { target: { botId: "scout", itemId: "thread:th-1", threadId: "th-1", seed: item }, onClose: vi.fn() }))));
};

describe("CodingChat draws a pending ask once (#4204)", () => {
  it("leaves the question its pinned card holds out of the window: no 'Waiting on you' copy", async () => {
    fixture.pinned = new Set(["q1"]);
    open(createPinnedHold());
    await vi.waitFor(() => expect(column.querySelector("[data-coding-line]")).not.toBeNull());
    // the thread was read for its waiting cards: the head had what to draw
    await vi.waitFor(() => expect(apiMock.mock.calls.filter(([url]) => String(url).startsWith("/api/threads/th-1/messages?limit=60")).length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(column.querySelector("[data-task-waiting]")).toBeNull();
    expect(column.querySelector('[data-test-option-card="q1"]')).toBeNull();
  });

  it("draws the head when no pinned card holds the question (nothing is lost)", async () => {
    fixture.pinned = new Set();
    open(createPinnedHold());
    await vi.waitFor(() => expect(column.querySelector('[data-task-waiting] [data-test-option-card="q1"]')).not.toBeNull());
  });

  it("never writes into the chat's hold: the chat keeps what its own pinned card holds, open and closed", async () => {
    fixture.pinned = new Set(["q1"]);
    const chat = createPinnedHold();
    chat.set(new Set(["chat-ask"]));
    open(chat);
    await vi.waitFor(() => expect(column.querySelector("[data-test-composer]")).not.toBeNull());
    expect([...chat.get()]).toEqual(["chat-ask"]);
    flushSync(() => root.render(createElement(PinnedHoldContext, { value: chat })));
    expect([...chat.get()]).toEqual(["chat-ask"]);
  });
});
