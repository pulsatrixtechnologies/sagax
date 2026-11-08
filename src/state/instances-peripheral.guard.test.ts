// @vitest-environment happy-dom
// #2719: the live store's instance snapshot kept whatever /api/instances
// answered. A proxy's empty 200 ({}), which refreshInstances already
// refuses, wiped the list to undefined, and every chat view read
// `instances.find` on it and crashed (the delegation card's work pane was
// the first to show it). The snapshot keeps the last usable list instead.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const answers: Record<string, unknown> = {
  // the proxy's empty 200: no list at all
  "/api/instances": {},
  "/api/config": {},
  "/api/routines": { routines: [], runs: [] },
  "/api/webhooks": { webhooks: [], attempts: [] },
};

const { StoreProvider, useStore } = await import("./store");

let seen!: AppState;
function Probe() {
  seen = useStore().state;
  return null;
}
let root: Root;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeAll(async () => {
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string) => path.startsWith("/api/bots?") ? json({ bots: [bot], groups: [] }) : json(answers[path.split("?")[0]!] ?? {}));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
  FixtureEventSource.opened[0]!.send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
});

describe("the instance snapshot", () => {
  it("keeps the last usable list when /api/instances answers without one", () => {
    expect(seen.bots.map((candidate) => candidate.id)).toEqual(["bot"]);
    expect(Array.isArray(seen.instances)).toBe(true);
  });
});
