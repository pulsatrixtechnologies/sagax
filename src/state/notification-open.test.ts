// @vitest-environment happy-dom
// A notification's click, a bot's own row and a search hit open a thread as
// the sidebar shows threads at that moment. With threads hidden a bot is one
// conversation and no other thread is ever a destination: a thread outside
// it (a job, a parallel task) opens in the side column beside it, and the
// conversation on screen reads every topic of it, the one the bot was left
// on too, and a job the bot opened itself (no thread has a sidebar row to
// clear it later, #1770). With threads shown the bot is selected first, as
// it always was, and a reply in the thread it leaves stays unread until
// that thread is opened: the server announces a switch on the live stream
// before it answers it (store.switchTask emits). The real provider, its live stream, the real
// display preference, and a fake server answering in the real one's order.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFrame } from "../../shared/wire";
import type { Action, AppState, BotAnnouncement } from "./store";
import { LAST_CONVERSATION_KEY } from "@/lib/last-conversation";

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id?: string) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}
class FixtureNotification {
  static permission = "granted";
  static shown: FixtureNotification[] = [];
  onclick: (() => void) | null = null;
  constructor(readonly title: string) { FixtureNotification.shown.push(this); }
}

// The person is in another bot's chat. Scout was left on "left-behind",
// where a routine's reply landed unread; the person last wrote in
// "main-chat"; "finished" is the side job the notification is about. With
// threads hidden, "left-behind" and "main-chat" are the topics of Scout's
// single stream, "main-chat" the newest; the side job opens alone.
const elsewhere: BotAnnouncement = {
  id: "other", threadId: "other-chat", name: "Other", title: "", description: "", notifications: true, unread: false,
  color: "blue", modelSelection: { instanceId: "fake", model: "m" }, tasks: [{ threadId: "other-chat", title: "Chat", createdAt: 1 }],
};
const scout: BotAnnouncement = {
  id: "scout", threadId: "left-behind", mainThreadId: "main-chat", name: "Scout", title: "", description: "",
  notifications: true, unread: true, color: "green", modelSelection: { instanceId: "fake", model: "m" },
  tasks: [
    { threadId: "left-behind", title: "Routine report", createdAt: 1, unread: true },
    { threadId: "main-chat", title: "Main chat", createdAt: 2 },
    // a job the bot opened on itself: outside the single stream
    { threadId: "finished", title: "Side job", createdAt: 3, unread: true, openedBy: { botId: "scout", name: "Scout", at: 3 } },
  ],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const requests: Array<{ path: string; body?: string }> = [];
/** Scout as the server keeps it: where it is, and what is unread. */
let server: BotAnnouncement;
/** The bot the app opens on at launch: the first one, nothing remembered. */
let firstBot = "other";
let state: AppState;
let dispatch: (action: Action) => void;

const { StoreProvider, useStore, openBot } = await import("./store");
const { landOnSearchHit } = await import("@/lib/focus-message");
const { closeSideThread, currentSideThread } = await import("@/lib/side-thread");
const { setAdvancedMode } = await import("@/lib/interface-mode");
const { setShowThreads } = await import("@/lib/thread-preferences");

let root: Root;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const stream = () => FixtureEventSource.opened.at(-1)!;
/** The server's bot frame now, a network hop later, then its answer. */
const announcedThen = (body: unknown) => new Promise<Response>((resolve) => setTimeout(() => {
  stream().send({ kind: "bot", bot: structuredClone(server) });
  setTimeout(() => resolve(json(body)), 0);
}, 0));

function Probe() {
  ({ state, dispatch } = useStore());
  return null;
}

beforeAll(() => {
  // Use persistent browser-like storage even on Node versions without it.
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("Notification", FixtureNotification);
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    requests.push({ path, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (path.startsWith("/api/bots?")) {
      const bots = [elsewhere, server].sort((bot) => bot.id === firstBot ? -1 : 0);
      return Promise.resolve(json({ bots: bots.map((bot) => ({ ...bot, messages: [] })), groups: [] }));
    }
    const switched = path.match(/^\/api\/bots\/scout\/tasks\/([\w-]+)/);
    if (switched && init?.method === "POST") {
      if (!server.tasks!.some((task) => task.threadId === switched[1])) return Promise.resolve(json({ error: "no such task" }, 404));
      // store.switchTask moves the selection and announces it; the route
      // answers with the snapshot it took then.
      server = { ...server, threadId: switched[1]! };
      return announcedThen({ bot: { ...structuredClone(server), messages: [] } });
    }
    if (path === "/api/bots/scout/read" && init?.method === "POST") {
      const { threadId } = JSON.parse(String(init.body));
      const tasks = server.tasks!.map((task) => task.threadId === threadId ? { ...task, unread: false } : task);
      server = { ...server, tasks, unread: tasks.some((task) => task.unread) };
      return announcedThen({ bot: structuredClone(server) });
    }
    if (typeof path === "string" && path.startsWith("/api/routines")) return Promise.resolve(json({ routines: [], runs: [] }));
    if (path === "/api/webhooks") return Promise.resolve(json({ webhooks: [], attempts: [] }));
    if (path === "/api/instances") return Promise.resolve(json({ instances: [] }));
    return Promise.resolve(json({}));
  });
});
afterAll(() => vi.unstubAllGlobals());
/** The app as it opens, on the conversation it remembers. */
async function launch() {
  server = structuredClone(scout);
  // A previous scenario must not decide which bot this launch restores.
  localStorage.setItem(LAST_CONVERSATION_KEY, firstBot);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
  stream().send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
}
// Each test starts from the app as it opens: in the other bot's chat.
beforeEach(async () => {
  firstBot = "other";
  await launch();
  expect(state.selectedId).toBe("other");
  expect(server.threadId).toBe("left-behind");
  requests.length = 0;
  FixtureNotification.shown.length = 0;
});
afterEach(() => { flushSync(() => root.unmount()); closeSideThread(); });

const threadsShown = async (shown: boolean) => {
  flushSync(() => { setAdvancedMode(true); setShowThreads(shown); });
  await settle();
};
const sent = () => requests.map((request) => request.body ? `${request.path} ${request.body}` : request.path);
/** The threads the window asked the server to mark read. */
const reads = () => requests.filter((request) => request.path === "/api/bots/scout/read").map((request) => JSON.parse(request.body!).threadId);
const scoutNow = () => state.bots.find((bot) => bot.id === "scout")!;
const unread = (threadId: string) => scoutNow().tasks!.find((task) => task.threadId === threadId)!.unread;

/** Scout's side job finished; the person clicks the notification. */
async function followNotification() {
  const frame: ServerFrame = { kind: "notify", notification: { kind: "done", botId: "scout", botName: "Scout", threadId: "finished", title: "Scout finished", body: "Side job done." } };
  stream().send(frame, "run:1");
  await settle();
  expect(FixtureNotification.shown).toHaveLength(1);
  FixtureNotification.shown[0]!.onclick!();
  await settle();
}

describe("following a notification", () => {
  it("opens a thread outside the one conversation beside it while threads are hidden, never in its place", async () => {
    await threadsShown(false);
    await followNotification();
    // no switch to the job: the conversation stays the one on screen
    expect(sent().filter((request) => request.startsWith("/api/bots/scout/tasks/finished"))).toHaveLength(0);
    expect(scoutNow().threadId).toBe("main-chat");
    expect(currentSideThread()).toEqual({ botId: "scout", threadId: "finished" });
    // the conversation reads its earlier topic with it
    expect(reads()).toContain("left-behind");
    expect(unread("left-behind")).toBe(false);
  });

  it("selects the bot first while threads are shown, as it always has", async () => {
    await threadsShown(true);
    await followNotification();
    expect(reads()).toEqual(["left-behind", "finished"]);
    expect(sent().filter((request) => request.startsWith("/api/bots/scout/tasks/finished"))).toHaveLength(1);
    expect(scoutNow().threadId).toBe("finished");
    expect(unread("finished")).toBe(false);
  });

  it("leaves the thread a failed switch stayed on as the one on screen while threads are shown", async () => {
    await threadsShown(true);
    // Deleted on the server a moment ago; this window has not heard yet.
    server = { ...server, tasks: server.tasks!.filter((task) => task.threadId !== "finished") };
    await followNotification();
    expect(scoutNow().threadId).toBe("left-behind");
  });
});

describe("opening a bot with threads hidden", () => {
  it("opens the one conversation from its row and reads the topic it was left on with it", async () => {
    await threadsShown(false);
    flushSync(() => openBot(dispatch, scoutNow(), false));
    await settle();
    expect(sent().filter((request) => request.startsWith("/api/bots/scout/tasks/main-chat"))).toHaveLength(1);
    expect(scoutNow().threadId).toBe("main-chat");
    // "left-behind" is an earlier topic of the conversation on screen; a
    // job the bot opened has no row with threads hidden, so it is read with
    // the conversation too, or it would keep the bot's badge up for good
    // (#1770, 26dd37f25)
    expect(reads()).toEqual(["left-behind", "finished"]);
    expect(unread("left-behind")).toBe(false);
    expect(unread("finished")).toBe(false);
  });

  // 2026-10-28: with one conversation, a thread outside the stream (a job
  // the bot opened) never takes the conversation's place: it opens in the
  // side column beside it (the reference design's thread beside the chat).
  it("lands on a search hit in a job thread beside the conversation, which stays at its newest topic", async () => {
    await threadsShown(false);
    closeSideThread();
    await landOnSearchHit({
      botId: "scout", name: "Scout", threadId: "finished", messageId: "hit", role: "bot", kind: "text", at: 3,
      snippet: "the side job is done", matchStart: 4, matchLength: 8, onActivePath: true,
    }, state, dispatch, false);
    await settle();
    expect(sent().filter((request) => request.startsWith("/api/bots/scout/tasks/finished"))).toEqual([]);
    expect(scoutNow().threadId).toBe("main-chat");
    expect(currentSideThread()).toEqual({ botId: "scout", threadId: "finished" });
    expect(state.focusMessage).toMatchObject({ threadId: "finished", messageId: "hit" });
  });
});

describe("the single stream (threads hidden, the default)", () => {
  it("opens a notification about an earlier topic at the newest topic, never by a switch to it", async () => {
    await threadsShown(false);
    const frame: ServerFrame = { kind: "notify", notification: { kind: "done", botId: "scout", botName: "Scout", threadId: "left-behind", title: "Scout", body: "Report ready." } };
    stream().send(frame, "run:2");
    await settle();
    FixtureNotification.shown.at(-1)!.onclick!();
    await settle();
    expect(sent().filter((request) => request.startsWith("/api/bots/scout/tasks/left-behind"))).toHaveLength(0);
    expect(scoutNow().threadId).toBe("main-chat");
  });

  it("lands on a search hit in an earlier topic in the stream: the newest topic, focused on the hit", async () => {
    await threadsShown(false);
    await landOnSearchHit({
      botId: "scout", name: "Scout", threadId: "left-behind", messageId: "old-hit", role: "bot", kind: "text", at: 1,
      snippet: "the routine report", matchStart: 4, matchLength: 7, onActivePath: true,
    }, state, dispatch, false);
    await settle();
    expect(sent().filter((request) => request.startsWith("/api/bots/scout/tasks/left-behind"))).toHaveLength(0);
    expect(scoutNow().threadId).toBe("main-chat");
    expect(state.focusMessage).toMatchObject({ threadId: "left-behind", messageId: "old-hit" });
  });
});

describe("launching the app on a bot", () => {
  /** Quit while Scout was on screen, left on the thread a reply waits in. */
  async function relaunch(shown: boolean) {
    flushSync(() => root.unmount());
    flushSync(() => { setAdvancedMode(true); setShowThreads(shown); });
    firstBot = "scout";
    requests.length = 0;
    await launch();
  }

  it("opens the one conversation while threads are hidden, reading the topic it was left on with it", async () => {
    await relaunch(false);
    expect(state.selectedId).toBe("scout");
    const switches = sent().filter((request) => request.startsWith("/api/bots/scout/tasks/"));
    expect(switches).toHaveLength(1);
    expect(switches[0]).toMatch(/^\/api\/bots\/scout\/tasks\/main-chat\b/);
    expect(scoutNow().threadId).toBe("main-chat");
    // the bot-opened job is read with it (#1770, 26dd37f25)
    expect(reads()).toEqual(["left-behind", "finished"]);
    expect(unread("left-behind")).toBe(false);
    expect(unread("finished")).toBe(false);
  });

  it("keeps the bot where it was while threads are shown, as it always has", async () => {
    await relaunch(true);
    expect(state.selectedId).toBe("scout");
    expect(sent().some((request) => request.startsWith("/api/bots/scout/tasks/"))).toBe(false);
    expect(scoutNow().threadId).toBe("left-behind");
  });
});
