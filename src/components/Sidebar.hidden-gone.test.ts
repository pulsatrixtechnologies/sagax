// #3576: a bot, group or person hidden from the sidebar is gone from it
// completely, in every width: no "Hidden (N)" row at its foot. The one place
// to bring an entry back is Settings > Appearance > Hidden from the sidebar.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  density: "comfortable" as SidebarDensity,
  hidden: [] as { kind: "bot" | "group" | "person"; id: string; at: number }[],
}));

// A static render reads the server snapshot of the hidden store (nothing
// hidden), so the person's hidden entries come from the fixture.
vi.mock("@/lib/sidebar-hidden", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-hidden")>(),
  useSidebarHidden: () => ({ items: fixture.hidden, unhideOnMessage: { people: true, bots: false } }),
}));

vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.density,
}));

import { BotEditorStore, initialState } from "@/state/store";
import { Sidebar } from "./Sidebar";

const bot = (id: string, name: string): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [],
});

const room = (id: string, name: string): Group => ({
  id, threadId: `t-${id}`, name, memberIds: [], defaultResponder: { kind: "everyone" },
  bulletin: "", unread: false, createdAt: 1, messages: [],
});

const hiddenBots = Array.from({ length: 14 }, (_, i) => bot(`b${i}`, `Tester ${String(i).padStart(2, "0")}`));
const shownBot = bot("shown", "Server");
const hiddenRoom = room("g1", "Reviewers");

const render = () => renderToStaticMarkup(
  createElement(BotEditorStore, {
    value: {
      state: { ...initialState, bots: [shownBot, ...hiddenBots], groups: [hiddenRoom], sections: [] },
      dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {},
    },
    children: createElement(Sidebar, { open: true, onClose: () => {} }),
  }),
);

beforeEach(() => {
  fixture.hidden = [
    ...hiddenBots.map((entry, at) => ({ kind: "bot" as const, id: entry.id, at })),
    { kind: "group" as const, id: hiddenRoom.id, at: 99 },
  ];
  setLocale("en");
});

afterEach(() => {
  fixture.hidden = [];
  vi.unstubAllGlobals();
  fixture.density = "comfortable";
  setLocale("en");
});

describe("hidden entries leave the sidebar completely (#3576)", () => {
  it.each([
    ["full width", "comfortable" as const, 1280],
    ["compact", "compact" as const, 1280],
    ["the icon rail", "icons" as const, 1280],
    ["the drawer of a narrow window", "comfortable" as const, 390],
  ])("draws nothing for fifteen hidden entries in %s", (_label, density, width) => {
    fixture.density = density;
    vi.stubGlobal("window", { innerWidth: width, innerHeight: 800, location: { protocol: "http:", search: "" } });
    const html = render();
    // the shown bot is still a row: the sidebar did render its list
    expect(html).toContain('data-sidebar-bot-row="shown"');
    expect(html).not.toContain("data-sidebar-hidden");
    expect(html).not.toMatch(/Hidden \(\d+\)/);
    for (const entry of hiddenBots) {
      expect(html).not.toContain(`data-sidebar-bot-row="${entry.id}"`);
      expect(html).not.toContain(entry.name);
    }
    expect(html).not.toContain('data-sidebar-group-row="g1"');
    expect(html).not.toContain("Reviewers");
  });
});
