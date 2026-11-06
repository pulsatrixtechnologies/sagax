// @vitest-environment happy-dom
// The real provider at launch (bug 2026-10-15): the device remembers a
// direct conversation with a person the viewer has since closed, and the
// snapshot holds no bot. The sidebar lists nothing, so the main column must
// show its empty state, not the closed conversation, and the remembered id
// is forgotten. Then the open conversation disappears while it is open.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppState } from "./store";
import { LAST_CONVERSATION_KEY } from "@/lib/last-conversation";
import { mainConversation } from "@/lib/main-view";
import { SIDEBAR_HIDDEN_KEY } from "@/lib/sidebar-hidden";

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id?: string) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}

const dmWithGaby = {
  id: "dm-gaby", threadId: "t-dm-gaby", name: "Gaby Pelletier", memberIds: [], humanIds: ["pr_me", "pr_gaby"], peopleDm: true,
  defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: 1, messages: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const saved = new Map<string, string>();
let state: AppState;
let shown: ReturnType<typeof mainConversation>;

const { StoreProvider, useStore } = await import("./store");

function Probe() {
  ({ state } = useStore());
  // what App.tsx renders in the main column
  shown = mainConversation(state.bots, state.groups, state.selectedId, state.sidebarHiddenKeys);
  return null;
}

let root: Root;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const stream = () => FixtureEventSource.opened.at(-1)!;

beforeAll(() => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string) => {
    if (path.startsWith("/api/bots?")) return Promise.resolve(json({ bots: [], groups: [structuredClone(dmWithGaby)] }));
    if (typeof path === "string" && path.startsWith("/api/routines")) return Promise.resolve(json({ routines: [], runs: [] }));
    if (path === "/api/webhooks") return Promise.resolve(json({ webhooks: [], attempts: [] }));
    if (path === "/api/instances") return Promise.resolve(json({ instances: [] }));
    return Promise.resolve(json({}));
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => flushSync(() => root.unmount()));

async function launch() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
  stream().send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
}

describe("launch with only a closed direct conversation", () => {
  it("shows the empty state and forgets the remembered conversation", async () => {
    saved.clear();
    saved.set(LAST_CONVERSATION_KEY, dmWithGaby.id);
    saved.set(SIDEBAR_HIDDEN_KEY, JSON.stringify({ items: [{ kind: "person", id: "pr_gaby", at: 1 }], unhideOnMessage: { people: true, bots: false } }));
    await launch();
    expect(state.hydrated).toBe(true);
    expect(state.groups.map((group) => group.id)).toEqual([dmWithGaby.id]);
    expect(state.selectedId).toBe("");
    expect(shown).toEqual({});
    expect(saved.has(LAST_CONVERSATION_KEY)).toBe(false);
  });
});

describe("the open direct conversation disappears", () => {
  it("empties the page when the server deletes it", async () => {
    saved.clear();
    saved.set(LAST_CONVERSATION_KEY, dmWithGaby.id);
    await launch();
    expect(state.selectedId).toBe(dmWithGaby.id);
    expect(shown.group?.id).toBe(dmWithGaby.id);
    stream().send({ kind: "group.deleted", groupId: dmWithGaby.id }, "run:1");
    await settle();
    expect(state.selectedId).toBe("");
    expect(shown).toEqual({});
    expect(saved.has(LAST_CONVERSATION_KEY)).toBe(false);
  });
});
