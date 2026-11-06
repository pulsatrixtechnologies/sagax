// #2045: the sidebar lists the viewer's own teams only. The server sends
// that person's list; a room someone else filed in their team ("Finance")
// never brings the other person's team name into this sidebar.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

import { BotEditorStore, initialState } from "@/state/store";
import { seedPersonalSections, personalSectionNames } from "@/lib/personal-sections";
import { Sidebar } from "./Sidebar";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});
const room = (id: string, section?: string, ownerId?: string | null): Group => ({
  id, threadId: `t-${id}`, name: id, memberIds: [], defaultResponder: { kind: "everyone" },
  bulletin: "", unread: false, createdAt: 1, messages: [], ...(section ? { section } : {}), ...(ownerId !== undefined ? { ownerId } : {}),
});

const render = (state: { bots: Bot[]; groups: Group[]; sections: string[] }) => renderToStaticMarkup(
  createElement(BotEditorStore, { value: { state: { ...initialState, ...state }, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children: createElement(Sidebar, { open: true, onClose: () => {} }) }),
);

beforeEach(() => {
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, location: { protocol: "http:", search: "" } });
});

describe("sidebar team isolation (#2045)", () => {
  // Anne's view: her bot in Ops; a shared room Benoit filed in his Finance.
  const anne = { bots: [bot("mochi", { section: "Ops" })], groups: [room("crew", "Finance", "pr_benoit")], sections: ["Ops"] };

  it("shows only the viewer's teams, never another person's empty or filed team", () => {
    const html = render(anne);
    expect(html).toContain('data-sidebar-section-id="section:Ops"');
    expect(html).toContain('data-sidebar-bot-row="mochi"');
    expect(html).not.toContain("section:Finance");
    expect(html).not.toContain("section:Agents personels");
    // the shared room stays reachable, just not under someone else's team
    expect(html).toContain('data-sidebar-group-row="crew"');
  });

  it("a solo server's rooms keep their team as they are", () => {
    const html = render({ bots: [], groups: [room("crew", "Finance")], sections: [] });
    expect(html).toContain('data-sidebar-section-id="section:Finance"');
  });

  it("a first organization sign-in seeds the viewer's own teams only", () => {
    const seeded = seedPersonalSections({ ...anne, viewerId: "pr_anne" });
    expect(personalSectionNames(seeded)).toEqual(["Ops"]);
  });
});
