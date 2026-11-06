// @vitest-environment happy-dom
// New chat sticks (JC 2026-11-02), the real store and the real chat: click
// New chat, type, the chat stays empty; switch to another bot and back, it is
// still empty; a reload keeps it; the first message creates the new topic on
// the server and goes there, the earlier topic stays in the bot's threads and
// is not drawn back above the new one.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState } from "@/state/store";
import { resetFreshTopicMemory } from "@/lib/fresh-topic";
import { setLocale } from "@/lib/i18n";

setLocale("en");

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id?: string) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => null }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const wireBot = (id: string) => ({
  id, threadId: `${id}-now`, mainThreadId: `${id}-now`, name: id.toUpperCase(), title: "", description: "Ready when you are.", color: "green",
  notifications: true, unread: false, busy: false, hasMore: false,
  messages: [{ id: `${id}-m1`, role: "bot", kind: "text", text: `old answer ${id}`, at: 4 }],
  modelSelection: { instanceId: "x", model: "m" },
  tasks: [{ threadId: `${id}-first`, title: "First", createdAt: 1, updatedAt: 2 }, { threadId: `${id}-now`, title: "Now", createdAt: 3, updatedAt: 4 }],
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const saved = new Map<string, string>();
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let state: AppState;
let dispatch: (action: Action) => void;

const { StoreProvider, useStore, openBot } = await import("@/state/store");
const { ChatView } = await import("./ChatView");

function Shell() {
  ({ state, dispatch } = useStore());
  const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
  return bot ? createElement(ChatView, { bot }) : null;
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const stream = () => FixtureEventSource.opened.at(-1)!;
const bot = (id: string) => state.bots.find((candidate) => candidate.id === id)!;

async function launch() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Shell))));
  await settle();
  stream().send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
}
function unmount() {
  flushSync(() => root.unmount());
  host.remove();
}
async function type(text: string) {
  const input = host.querySelector("textarea")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  for (let at = 1; at <= text.length; at++) {
    setValue.call(input, text.slice(0, at));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  }
}

beforeAll(() => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (init?.method === "POST") posts.push({ path, body });
    if (path.startsWith("/api/bots?")) return Promise.resolve(json({ bots: [wireBot("a"), wireBot("b")], groups: [] }));
    if (path.split("?")[0] === "/api/routines") return Promise.resolve(json({ routines: [], runs: [] }));
    if (path === "/api/webhooks") return Promise.resolve(json({ webhooks: [], attempts: [] }));
    if (path === "/api/instances") return Promise.resolve(json({ instances: [] }));
    // an earlier topic read back above the live one
    if (path.startsWith("/api/threads/a-now/messages")) return Promise.resolve(json({ messages: wireBot("a").messages, hasMore: false }));
    if (path.startsWith("/api/threads/a-first/messages")) return Promise.resolve(json({ messages: [], hasMore: false }));
    if (path === "/api/bots/a/tasks" && init?.method === "POST") {
      const made = { ...wireBot("a"), threadId: "a-new", mainThreadId: "a-new", messages: [{ id: "u1", role: "user", kind: "text", text: "hello", at: 6 }],
        tasks: [...wireBot("a").tasks, { threadId: "a-new", title: "", createdAt: 5 }] };
      return Promise.resolve(json({ bot: made, task: { threadId: "a-new" } }));
    }
    return Promise.resolve(json({}));
  });
});
beforeEach(() => {
  saved.clear();
  posts.length = 0;
  resetFreshTopicMemory();
  saved.set("sagax.lastConversation.v1", "a");
});
afterEach(() => resetFreshTopicMemory());
afterAll(() => vi.unstubAllGlobals());

describe("Clear chat in the ... menu (JC 2026-11-06)", () => {
  it("is an entry of the conversation menu, never a button of its own, and starts the fresh topic", async () => {
    await launch();
    expect(host.querySelector("[data-new-topic]")).toBeNull();
    expect(host.querySelector("[data-chat-clear]")).toBeNull();
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-clear-chat-menu="a"]')!.click());
    const clear = host.querySelector<HTMLButtonElement>('[role="menu"] [data-chat-clear][data-new-topic="a"]');
    expect(clear?.textContent).toContain("Clear chat");
    expect([...host.querySelectorAll("[data-chat-clear]")].every((node) => node.closest('[role="menu"]'))).toBe(true);
    flushSync(() => clear!.click());
    await settle();
    expect(posts.some((post) => post.path === "/api/bots/a/tasks")).toBe(true);
    expect(host.textContent).not.toContain("old answer a");
    expect(host.querySelector('[data-clear-chat-menu="a"]')?.getAttribute("aria-expanded")).toBe("false");
    unmount();
  });
});

describe("New chat sticks", () => {
  it("stays empty through typing, a switch away and back, a live frame and a reload, then the send makes the new topic", async () => {
    await launch();
    expect(state.selectedId).toBe("a");
    expect(host.textContent).toContain("old answer a");

    flushSync(() => host.querySelector<HTMLButtonElement>('[data-clear-chat-menu="a"]')!.click());
    flushSync(() => host.querySelector<HTMLButtonElement>('[role="menu"] [data-chat-clear]')!.click());
    await settle();
    expect(host.textContent).not.toContain("old answer a");
    expect(host.querySelector("[data-fresh-topic-divider]")).toBeTruthy();

    await type("hello");
    expect(host.querySelector("textarea")!.value).toBe("hello");
    expect(host.textContent).not.toContain("old answer a");

    // another bot, then back
    openBot(dispatch, bot("b"), false);
    await settle();
    expect(host.textContent).toContain("old answer b");
    openBot(dispatch, bot("a"), false);
    await settle();
    expect(host.textContent).not.toContain("old answer a");
    expect(host.querySelector("[data-fresh-topic-divider]")).toBeTruthy();

    // a live frame for the covered topic
    stream().send({ kind: "bot", bot: { ...wireBot("a"), tasks: [wireBot("a").tasks[0], { ...wireBot("a").tasks[1], updatedAt: 4 }] } }, "run:1");
    await settle();
    expect(host.textContent).not.toContain("old answer a");

    // a reload
    unmount();
    resetFreshTopicMemory();
    await launch();
    expect(state.freshTopic.a).toEqual({ threadId: "a-now", auto: false });
    expect(host.textContent).not.toContain("old answer a");
    expect(posts.some((post) => post.path === "/api/bots/a/tasks")).toBe(false);

    // the first message creates the topic, then goes there
    dispatch({ type: "send", botId: "a", text: "hello" } as Action);
    await settle();
    const created = posts.filter((post) => post.path === "/api/bots/a/tasks");
    expect(created).toEqual([{ path: "/api/bots/a/tasks", body: { stream: true } }]);
    expect(posts.find((post) => post.path === "/api/bots/a/messages")?.body.threadId).toBe("a-new");
    expect(bot("a").threadId).toBe("a-new");
    expect(state.freshTopic.a).toBeUndefined();
    // the earlier topic stays in the bot's threads, not drawn above the new one
    expect(bot("a").tasks?.map((task) => task.threadId)).toEqual(["a-first", "a-now", "a-new"]);
    expect(host.textContent).toContain("hello");
    expect(host.textContent).not.toContain("old answer a");
    unmount();
  });

  it("an ordinary topic still draws the earlier topic above once read back (control)", async () => {
    const page = { ...wireBot("a"), threadId: "a-new", mainThreadId: "a-new", messages: [{ id: "u1", role: "user", kind: "text", text: "hello", at: 6 }],
      tasks: [...wireBot("a").tasks, { threadId: "a-new", title: "", createdAt: 5, updatedAt: 6 }] };
    await launch();
    dispatch({ type: "taskSwitched", bot: page } as unknown as Action);
    await settle();
    expect(bot("a").threadId).toBe("a-new");
    expect(host.textContent).toContain("old answer a");
    unmount();
  });
});
