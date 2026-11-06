// @vitest-environment happy-dom
// The store keeps one data sheet per bot and loads it from the panel route.
// A `data` frame replaces the sheet whole; the panel itself runs and cancels
// SQL (DataPanel.test.ts) and leaves the answer to the frame.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DATA_ROUTES, dataSheetKey, withDataThread, type DataSheet } from "../../shared/data-surface";
import type { ServerFrame } from "../../shared/wire";
import type { AppState, BotAnnouncement } from "./store";

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id?: string) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}

const bot: BotAnnouncement = {
  id: "bot", threadId: "thread", name: "Fixture", title: "", description: "",
  notifications: true, unread: false, color: "green",
  modelSelection: { instanceId: "fake", model: "m" },
  tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask" }],
};
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
const sheet = (cardIds: string[]): DataSheet => ({
  version: 1, botId: "bot", updatedAt: "2026-10-09T10:00:00.000Z", sources: [],
  cards: cardIds.map((id) => ({ id, kind: "table", title: id, status: "ready", by: "bot", createdAt: "2026-10-09T10:00:00.000Z", updatedAt: "2026-10-09T10:00:00.000Z" })),
});
const requests: Array<{ path: string; method: string; body: unknown }> = [];
const answers: Record<string, unknown> = {
  "/api/instances": { instances: [] },
  "/api/config": {},
  "/api/routines": { routines: [], runs: [] },
  "/api/webhooks": { webhooks: [], attempts: [] },
  [DATA_ROUTES.sheet("bot")]: sheet(["from-get"]),
  [withDataThread(DATA_ROUTES.sheet("bot"), "secret")]: sheet(["thread-own"]),
};

const { StoreProvider, useStore, dataSheetFromResponse } = await import("./store");

let seen!: AppState;
let dispatch!: ReturnType<typeof useStore>["dispatch"];
function Probe() {
  const store = useStore();
  seen = store.state;
  dispatch = store.dispatch;
  return null;
}
let root: Root;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const stream = () => FixtureEventSource.opened[0]!;
let cursor = 0;
const send = async (frame: ServerFrame) => {
  stream().send(frame, `run:${++cursor}`);
  await settle();
};
const sent = (path: string) => requests.filter((request) => request.path === path);

beforeAll(async () => {
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    requests.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return path.startsWith("/api/bots?") ? json({ bots: [bot], groups: [] }) : path.startsWith("/api/routines") ? json(answers["/api/routines"] ?? {}) : json(answers[path] ?? {});
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
  stream().send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
});

describe("data sheets in the store", () => {
  it("start empty and are not fetched with the app", () => {
    expect(seen.dataSheets).toEqual({});
    expect(sent(DATA_ROUTES.sheet("bot"))).toHaveLength(0);
  });

  it("load once from GET when the tab asks", async () => {
    dispatch({ type: "loadDataSheet", botId: "bot" });
    await settle();
    expect(sent(DATA_ROUTES.sheet("bot"))).toHaveLength(1);
    expect(seen.dataSheets.bot?.cards.map((card) => card.id)).toEqual(["from-get"]);
  });

  it("are replaced whole by a data frame", async () => {
    await send({ kind: "data", botId: "bot", sheet: sheet(["a", "b"]) });
    expect(seen.dataSheets.bot?.cards.map((card) => card.id)).toEqual(["a", "b"]);
    await send({ kind: "data", botId: "bot", sheet: sheet(["b"]) });
    expect(seen.dataSheets.bot?.cards.map((card) => card.id)).toEqual(["b"]);
    expect(seen.dataSheets.bot?.botId).toBe("bot");
  });

  it("keep a confidential thread's own sheet apart from the bot's, from GET and from frames", async () => {
    dispatch({ type: "loadDataSheet", botId: "bot", threadId: "secret" });
    await settle();
    expect(sent("/api/bots/bot/data?thread=secret")).toHaveLength(1);
    expect(seen.dataSheets[dataSheetKey("bot", "secret")]?.cards.map((card) => card.id)).toEqual(["thread-own"]);
    const before = seen.dataSheets.bot?.cards.map((card) => card.id);
    await send({ kind: "data", botId: "bot", threadId: "secret", sheet: sheet(["t1"]) });
    expect(seen.dataSheets["bot#secret"]?.cards.map((card) => card.id)).toEqual(["t1"]);
    expect(seen.dataSheets.bot?.cards.map((card) => card.id)).toEqual(before);
  });

  it("build thread routes and keys", () => {
    expect(withDataThread("/api/bots/b/data/page", "t 1")).toBe("/api/bots/b/data/page?thread=t%201");
    expect(withDataThread(DATA_ROUTES.histogram("b", "x", "c"), "t")).toBe("/api/bots/b/data/tables/x/histogram?column=c&thread=t");
    expect(withDataThread("/api/bots/b/data")).toBe("/api/bots/b/data");
    expect(dataSheetKey("b")).toBe("b");
    expect(dataSheetKey("b", "t")).toBe("b#t");
  });

  it("tell the panel, not the app, when the route refuses", async () => {
    vi.stubGlobal("fetch", (path: string) => path === DATA_ROUTES.sheet("other")
      ? Promise.resolve(new Response(JSON.stringify({ error: "Not Found" }), { status: 404 }))
      : json(answers[path] ?? {}));
    const onError = vi.fn();
    dispatch({ type: "loadDataSheet", botId: "other", onError });
    await settle();
    expect(onError).toHaveBeenCalledWith("Not Found");
    expect(seen.error).toBeNull();
    expect(seen.dataSheets.other).toBeUndefined();
  });

  it("read a sheet from either answer shape, and an empty sheet from nothing", () => {
    const direct = sheet(["x"]);
    expect(dataSheetFromResponse(direct, "bot")).toEqual(direct);
    expect(dataSheetFromResponse({ sheet: direct }, "bot")).toEqual(direct);
    expect(dataSheetFromResponse({}, "bot")).toMatchObject({ version: 1, botId: "bot", cards: [], sources: [] });
    expect(dataSheetFromResponse({ version: 1, cards: [] }, "bot")).toMatchObject({ botId: "bot", sources: [] });
  });
});
