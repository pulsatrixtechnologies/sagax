// Keep people apart (#1661): unassigned people-DMs sit in builtin:people,
// next to Unassigned's bots and groups. Off mixes them back into Unassigned.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { setSidebarPeopleApart } from "@/lib/sidebar-people-apart-preference";

const fixture = vi.hoisted(() => ({
  state: {} as { bots?: Bot[]; groups?: Group[]; sections?: string[] },
}));

import { BotEditorStore, initialState } from "@/state/store";
import { Sidebar } from "./Sidebar";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});

const person = (id: string, section?: string): Group => ({
  id, threadId: `t-${id}`, name: id, memberIds: [], humanIds: ["pr_me", `pr_${id}`], peopleDm: true,
  defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, createdAt: 1, messages: [],
  ...(section ? { section } : {}),
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
  setSidebarPeopleApart(true);
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, location: { protocol: "http:", search: "" } });
});

describe("sidebar people apart", () => {
  it("puts unassigned people in People, next to Unassigned bots and groups", () => {
    fixture.state = {
      bots: [bot("mochi"), bot("ops", { section: "Ops" })],
      groups: [person("ada"), person("bob", "Ops"), room("crew")],
      sections: ["Ops"],
    };
    const html = render();
    expect(html).toContain('data-sidebar-section-id="builtin:general"');
    expect(html).toContain('data-sidebar-section-id="builtin:people"');
    expect(html).toContain('data-section="People"');
    expect(html).toContain('data-sidebar-bot-row="mochi"');
    expect(html).toContain('data-sidebar-group-row="crew"');
    expect(html).toContain('data-sidebar-group-row="ada"');
    expect(html).toContain('data-sidebar-section-id="section:Ops"');
    expect(html).toContain('data-sidebar-group-row="bob"');
    // Ada is under People, not listed as a general-section-only mix check via order:
    const peopleAt = html.indexOf('data-sidebar-section-id="builtin:people"');
    const adaAt = html.indexOf('data-sidebar-group-row="ada"');
    const generalAt = html.indexOf('data-sidebar-section-id="builtin:general"');
    expect(peopleAt).toBeGreaterThan(-1);
    expect(adaAt).toBeGreaterThan(peopleAt);
    expect(generalAt).toBeGreaterThan(-1);
    expect(html.indexOf('data-sidebar-bot-row="mochi"')).toBeGreaterThan(generalAt);
  });

  it("keeps a person filed in a personal section with that section", () => {
    fixture.state = {
      bots: [bot("mochi", { section: "Client X" })],
      groups: [person("ada", "Client X"), person("sam")],
      sections: ["Client X"],
    };
    const html = render();
    expect(html).toContain('data-sidebar-section-id="section:Client X"');
    expect(html).toContain('data-sidebar-group-row="ada"');
    expect(html).toContain('data-sidebar-section-id="builtin:people"');
    expect(html).toContain('data-sidebar-group-row="sam"');
    expect(html).not.toContain('data-sidebar-section-id="builtin:general"');
  });

  it("mixes people back into Unassigned when the setting is off", () => {
    setSidebarPeopleApart(false);
    fixture.state = {
      bots: [bot("mochi")],
      groups: [person("ada"), room("crew")],
      sections: ["Ops"],
    };
    const html = render();
    expect(html).not.toContain('data-sidebar-section-id="builtin:people"');
    expect(html).toContain('data-sidebar-section-id="builtin:general"');
    expect(html).toContain('data-sidebar-group-row="ada"');
    expect(html).toContain('data-sidebar-group-row="crew"');
    expect(html).toContain('data-sidebar-bot-row="mochi"');
  });
});
