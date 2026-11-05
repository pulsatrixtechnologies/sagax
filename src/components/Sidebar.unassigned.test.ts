// The default section is labeled Unassigned (stored id builtin:general).
// Hide that header and its empty block when it has no bot rows. A pinned
// bot already sits in the pin grid. Named sections stay, empty ones included.
// A room with no bot of its own still lists here, or it would disappear.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  state: {} as { bots?: Bot[]; groups?: Group[]; sections?: string[] },
}));

import { BotEditorStore, initialState } from "@/state/store";
import { Sidebar } from "./Sidebar";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});

const room = (id: string, section?: string): Group => ({
  id, threadId: `t-${id}`, name: id, memberIds: [], defaultResponder: { kind: "everyone" },
  bulletin: "", unread: false, createdAt: 1, messages: [], ...(section ? { section } : {}),
});

const render = () => renderToStaticMarkup(
  createElement(BotEditorStore, { value: { state: { ...initialState, ...fixture.state }, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children: createElement(Sidebar, { open: true, onClose: () => {} }) }),
);

beforeEach(() => {
  fixture.state = { bots: [], groups: [], sections: [] };
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, location: { protocol: "http:", search: "" } });
});

describe("sidebar Unassigned section", () => {
  it("omits the header and the empty block when nothing is filed there", () => {
    fixture.state = { bots: [], groups: [], sections: ["Ops"] };
    const html = render();
    expect(html).not.toContain('data-sidebar-section-id="builtin:general"');
    expect(html).not.toContain('data-section="Unassigned"');
    expect(html).toContain('data-sidebar-section-id="section:Ops"');
    expect(html).toContain('data-section="Ops"');
  });

  it("keeps Unassigned when it has a bot row, and leaves a pinned bot in the pin grid only", () => {
    fixture.state = {
      bots: [bot("mochi"), bot("pinny", { pinned: true }), bot("ops", { section: "Ops" })],
      groups: [],
      sections: ["Ops"],
    };
    const html = render();
    expect(html).toContain('data-sidebar-section-id="builtin:general"');
    expect(html).toContain('data-section="Unassigned"');
    expect(html).toContain('data-sidebar-bot-row="mochi"');
    expect(html).toContain('data-sidebar-section-id="section:Ops"');
    expect(html).toContain('data-sidebar-bot-row="ops"');
    expect(html).toContain(">pinny</span>");
    expect(html).not.toContain('data-sidebar-bot-row="pinny"');
  });

  it("hides Unassigned when its only bots are pinned", () => {
    fixture.state = {
      bots: [bot("pinny", { pinned: true }), bot("ops", { section: "Ops", pinned: true })],
      groups: [],
      sections: ["Ops"],
    };
    const html = render();
    expect(html).not.toContain('data-sidebar-section-id="builtin:general"');
    expect(html).not.toContain('data-section="Unassigned"');
    expect(html).not.toContain('data-sidebar-bot-row="pinny"');
    expect(html).toContain(">pinny</span>");
    expect(html).toContain('data-sidebar-section-id="section:Ops"');
    expect(html).toContain('data-section="Ops"');
    expect(html).toContain(">ops</span>");
    expect(html).not.toContain('data-sidebar-bot-row="ops"');
  });

  it("still lists a room that has no bot under Unassigned", () => {
    fixture.state = { bots: [], groups: [room("crew")], sections: ["Ops"] };
    const html = render();
    expect(html).toContain('data-sidebar-section-id="builtin:general"');
    expect(html).toContain('data-section="Unassigned"');
    expect(html).toContain('data-sidebar-group-row="crew"');
    expect(html).toContain('data-section="Ops"');
  });

  it("shows the bots without an Unassigned header when there is no team", () => {
    fixture.state = { bots: [bot("mochi"), bot("dumpling")], groups: [], sections: [] };
    const html = render();
    expect(html).not.toContain('data-section="Unassigned"');
    expect(html).toContain('data-sidebar-bot-row="mochi"');
    expect(html).toContain('data-sidebar-bot-row="dumpling"');
  });

  it("types no team name in the sidebar: a team is made from a bot's Move to ›", () => {
    fixture.state = { bots: [bot("mochi"), bot("ops", { section: "Ops" })], groups: [], sections: ["Ops"] };
    const html = render();
    expect(html).not.toContain("data-section-name-input");
    expect(html).not.toContain('placeholder="Team name"');
  });
});
