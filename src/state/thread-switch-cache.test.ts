// @vitest-environment happy-dom
// Thread switching with the real provider: a switch back to a thread seen
// before draws its cached page at once (Bot.switchPreview) and then takes the
// switch's own page; the sidebar prefetch is a GET that never moves the
// selection; a thread never seen opens as before, on the switch's answer.
import { createElement, type Dispatch } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, StoreProvider, useStore, type Action, type AppState, type Bot, type Message } from "./store";
import { useThreadPrefetch } from "./thread-prefetch";
import type { ThreadPrefetcher } from "@/lib/thread-page-cache";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const message = (id: string, text: string): Message => ({ id, role: "user", kind: "text", text, at: 1 } as Message);
const scout = (threadId: string, messages: Message[]): Bot => ({
  id: "B", name: "Scout", threadId, title: "", description: "", color: "green", unread: false, notifications: true,
  messages, modelSelection: { instanceId: "fake", model: "test" },
  tasks: [{ threadId: "one", title: "One", createdAt: 1 }, { threadId: "two", title: "Two", createdAt: 2 }],
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
class OfflineEvents {
  onopen = null;
  onerror = null;
  onmessage = null;
  close() {}
}

const original = { bots: initialState.bots, selectedId: initialState.selectedId, activeView: initialState.activeView };
let host: HTMLDivElement;
let root: Root;
let seen: AppState;
let dispatch: Dispatch<Action>;
let prefetch: ThreadPrefetcher | null;
let requests: ReturnType<typeof vi.fn<typeof fetch>>;
let pending: Map<string, ReturnType<typeof deferred>>;

function Probe() {
  const store = useStore();
  seen = store.state;
  dispatch = store.dispatch;
  prefetch = useThreadPrefetch();
  return null;
}
const bot = () => seen.bots.find((candidate) => candidate.id === "B")!;
const answer = async (key: string, body: unknown) => {
  await vi.waitFor(() => expect(pending.has(key)).toBe(true));
  await act(async () => { pending.get(key)!.resolve(response(body)); });
};
const calls = () => requests.mock.calls.map(([path, init]) => `${init?.method ?? "GET"} ${String(path)}`);

beforeEach(() => {
  Object.assign(initialState, { bots: [scout("one", [message("m1", "first thread")])], selectedId: "B", activeView: "chat" });
  pending = new Map();
  requests = vi.fn<typeof fetch>((path) => {
    const key = String(path);
    if (!key.startsWith("/api/bots/B/tasks/") && !key.startsWith("/api/threads/")) return new Promise(() => {});
    const waiting = deferred();
    pending.set(key.split("?")[0]!, waiting);
    return waiting.promise;
  });
  vi.stubGlobal("fetch", requests);
  vi.stubGlobal("EventSource", OfflineEvents);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.assign(initialState, original);
  vi.unstubAllGlobals();
});

describe("thread switching from the page cache", () => {
  it("opens a thread never seen on the switch's answer, then draws a thread left behind at once", async () => {
    await act(async () => dispatch({ type: "switchTask", botId: "B", threadId: "two" }));
    expect(bot().switchingTo).toBe("two");
    expect(bot().switchPreview).toBeUndefined();
    await answer("/api/bots/B/tasks/two", { bot: scout("two", [message("m2", "second thread")]) });
    expect(bot().threadId).toBe("two");

    // back to "one": the page it was left with is drawn while the switch runs
    await act(async () => dispatch({ type: "switchTask", botId: "B", threadId: "one" }));
    expect(bot().switchingTo).toBe("one");
    expect(bot().switchPreview?.threadId).toBe("one");
    expect(bot().switchPreview?.messages.map((m) => m.id)).toEqual(["m1"]);
    // still on "two" underneath: only the switch moves the thread
    expect(bot().threadId).toBe("two");
    await answer("/api/bots/B/tasks/one", { bot: scout("one", [message("m1", "first thread"), message("m3", "newer")]) });
    expect(bot().threadId).toBe("one");
    expect(bot().switchPreview).toBeUndefined();
    expect(bot().messages.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("prefetches with a GET only, then draws the prefetched page on the switch", async () => {
    expect(prefetch).not.toBeNull();
    await act(async () => prefetch!.focus("two"));
    await answer("/api/threads/two/messages", { messages: [message("m2", "second thread")], hasMore: false, activeLeafId: "m2" });
    expect(calls()).toContain("GET /api/threads/two/messages?limit=200");
    expect(calls().some((call) => call.startsWith("POST"))).toBe(false);
    expect(bot().threadId).toBe("one");
    expect(seen.selectedId).toBe("B");

    await act(async () => dispatch({ type: "switchTask", botId: "B", threadId: "two" }));
    expect(bot().switchPreview).toMatchObject({ threadId: "two", activeLeafId: "m2", messages: [{ id: "m2" }] });
    await answer("/api/bots/B/tasks/two", { bot: scout("two", [message("m2", "second thread")]) });
    expect(bot().switchPreview).toBeUndefined();
  });

  it("drops the preview when the switch fails", async () => {
    await act(async () => prefetch!.focus("two"));
    await answer("/api/threads/two/messages", { messages: [message("m2", "second thread")] });
    await act(async () => dispatch({ type: "switchTask", botId: "B", threadId: "two" }));
    expect(bot().switchPreview?.threadId).toBe("two");
    await vi.waitFor(() => expect(pending.has("/api/bots/B/tasks/two")).toBe(true));
    await act(async () => { pending.get("/api/bots/B/tasks/two")!.resolve(response({ error: "no such thread" }, 404)); });
    await vi.waitFor(() => expect(bot().switchingTo).toBeUndefined());
    expect(bot().switchPreview).toBeUndefined();
    expect(bot().threadId).toBe("one");
  });

  it("ends a pending switch whose response carries no bot", async () => {
    await act(async () => dispatch({ type: "switchTask", botId: "B", threadId: "two" }));
    expect(bot().switchingTo).toBe("two");
    await answer("/api/bots/B/tasks/two", {});
    await vi.waitFor(() => expect(bot().switchingTo).toBeUndefined());
    expect(bot().switchPreview).toBeUndefined();
    expect(bot().threadId).toBe("one");
  });
});
