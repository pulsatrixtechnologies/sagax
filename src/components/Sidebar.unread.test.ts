// An unread row reads like Messages or Slack: the name goes bold and the
// preview takes the primary text colour. No dot; the row keeps an
// accessible "Unread" label for screen readers.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as { bots?: Bot[]; groups?: Group[]; sections?: string[] } }));


import { BotEditorStore, initialState } from "@/state/store";
import { Sidebar } from "./Sidebar";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});

const room = (id: string, extra: Partial<Group> = {}): Group => ({
  id, threadId: `t-${id}`, name: id, memberIds: [], defaultResponder: { kind: "everyone" },
  bulletin: "", unread: false, createdAt: 1, messages: [], ...extra,
});

const render = () => renderToStaticMarkup(
  createElement(BotEditorStore, { value: { state: { ...initialState, ...fixture.state }, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children: createElement(Sidebar, { open: true, onClose: () => {} }) }),
);

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, location: { protocol: "http:", search: "" } });
});

describe("sidebar unread rows", () => {
  // The reference design's rows (owner, 2026-10-15): an unread bot keeps its name's
  // weight and gets one blue dot at the row's end.
  it("marks an unread bot with one blue dot at the row's end, keeps the Unread label, and no bold name", () => {
    fixture.state = { bots: [bot("quiet"), bot("loud", { unread: true })], groups: [], sections: [] };
    const html = render();
    expect(html.match(/data-sidebar-unread-dot/g)).toHaveLength(1);
    expect(html.match(/sr-only[^>]*>Unread threads</g)).toHaveLength(1);
    expect(html).not.toMatch(/font-semibold[^"]*"[^>]*>(?:<[^>]+>)*loud</);
    expect(html.indexOf("data-sidebar-unread-dot")).toBeGreaterThan(html.indexOf('data-sidebar-bot-row="loud"'));
  });

  it("shows a plain dot, never a number, on an unread conversation", () => {
    fixture.state = { bots: [bot("loud", {
      unread: true,
      messages: [
        { id: "u1", role: "user", kind: "text", text: "hi", at: 1 },
        { id: "b2", role: "bot", kind: "text", text: "one", at: 2 },
        { id: "b3", role: "bot", kind: "text", text: "two", at: 3 },
      ] as Bot["messages"],
    })], groups: [], sections: [] };
    const html = render();
    expect(html).not.toContain("data-unread-count");
    expect(html).not.toContain(">2<");
    expect(html).toContain("data-sidebar-unread-dot");
    expect(html).toMatch(/sr-only[^>]*>Unread threads</);
  });

  it("bolds an unread room and draws no dot", () => {
    fixture.state = { bots: [], groups: [room("read-room"), room("new-room", { unread: true })], sections: [] };
    const html = render();
    expect(html).not.toContain("data-sidebar-unread-dot");
    expect(html.match(/sr-only[^>]*>Unread threads</g)).toHaveLength(1);
    expect(html).toMatch(/font-semibold[^"]*"[^>]*>(?:<[^>]+>)*new-room</);
    expect(html).not.toMatch(/font-semibold[^"]*"[^>]*>(?:<[^>]+>)*read-room</);
  });
});
