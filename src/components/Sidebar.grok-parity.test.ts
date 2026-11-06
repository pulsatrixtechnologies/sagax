// The desktop sidebar measured on the reference design (owner, 2026-10-15): one row per
// bot (portrait, name, role pill, last message), its threads under it in
// the sidebar mode only, the Primary Bot at the top with its star and role, "My team" and
// "Built-in" sections, and a foot of the avatar and the Plugins pill.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Task } from "@/state/store";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";

const fixture = vi.hoisted(() => ({
  state: {} as { bots?: Bot[]; sections?: string[]; selectedId?: string; activeView?: AppState["activeView"] },
  places: [] as { key: string; label: string }[],
}));

vi.mock("@/lib/thread-preferences", async (original) => ({ ...await original<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
  useThreadsLocationChoice: () => "sidebar" as const,
  useThreadsMode: () => "sidebar" as const,
}));
vi.mock("./SidebarProfileMenu", async (original) => ({
  ...await original<typeof import("./SidebarProfileMenu")>(),
  SidebarProfileMenu: ({ places, avatarOnly }: { places: SidebarMenuItem[]; avatarOnly?: boolean }) => {
    fixture.places = places.map((place) => ({ key: place.key, label: String(place.label) }));
    return createElement("span", { "data-test-account": avatarOnly ? "avatar" : "row", "aria-haspopup": "menu" });
  },
}));
const flags = vi.hoisted(() => ({ connectedApps: true }));
vi.mock("@/lib/feature-flags", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/feature-flags")>(),
  connectedAppsEnabled: () => flags.connectedApps,
}));


import { setLocale } from "@/lib/i18n";
import { BotEditorStore, initialState } from "@/state/store";
import { Sidebar } from "./Sidebar";
import { forgetSearchDisclosuresForTests } from "@/lib/search-disclosure";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [], ...extra,
});

const render = () => renderToStaticMarkup(
  createElement(BotEditorStore, { value: { state: { ...initialState, ...fixture.state }, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }, children: createElement(Sidebar, { open: true, onClose: () => {} }) }),
);

beforeEach(() => {
  fixture.state = { bots: [], sections: [] };
  fixture.places = [];
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, location: { protocol: "http:", search: "" } });
  setLocale("fr");
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("threads under a bot in the sidebar mode", () => {
  const tasks: Task[] = [
    { threadId: "t-atlas", title: "Main", createdAt: 1, updatedAt: 1 },
    { threadId: "a", title: "Alpha", createdAt: 2, updatedAt: 20 },
    { threadId: "b", title: "Bravo", createdAt: 3, updatedAt: 50, unread: true },
  ];
  beforeEach(() => forgetSearchDisclosuresForTests());

  it("lists every thread of the bot, read or not, under its chevron", () => {
    fixture.state = { bots: [bot("atlas", { title: "Ops", tasks })], sections: [] };
    const html = render();
    expect(html).toContain('data-sidebar-bot-threads-toggle="atlas"');
    expect(html).toMatch(/data-sidebar-bot-threads-toggle="atlas"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*data-sidebar-bot-threads-toggle="atlas"/);
    for (const title of ["Alpha", "Bravo"]) expect(html).toContain(title);
    expect(html).toContain("data-sidebar-thread-row");
    // no unread-only sub-rows any more
    expect(html).not.toContain("data-sidebar-unread-thread");
  });
});

describe("Primary Bot at the top", () => {
  it("puts the viewer's Primary Bot in the top grid with its star and role, out of the rows below", () => {
    fixture.state = { bots: [bot("nova", { chiefOfStaff: true, title: "Chef de cabinet" }), bot("atlas", { title: "Ops" })], sections: [] };
    const html = render();
    const grid = html.slice(0, html.indexOf("data-sidebar-section-id") > 0 ? html.indexOf("data-sidebar-section-id") : html.indexOf('data-sidebar-bot-row="atlas"'));
    expect(grid).toContain(">nova</span>");
    expect(grid).toContain('data-testid="primary-bot-badge"');
    expect(grid).toMatch(/data-bot-role-tag=""[^>]*><span[^>]*>Chef de cabinet</);
    // The reference design's pinned tile: 95px, 10px corners, 12px name
    expect(grid).toContain("w-[95px]");
    expect(grid).toContain("rounded-[10px]");
    expect(grid).toContain("text-[12px]");
    expect(grid).toContain('data-sidebar-tile-labels=""');
    expect(html).not.toContain('data-sidebar-bot-row="nova"');
    expect(html).toContain('data-sidebar-bot-row="atlas"');
  });

  it("draws the star as the reference design's corner: 16px at 60px, flush in the corner, an 8px star", () => {
    fixture.state = { bots: [bot("nova", { chiefOfStaff: true })], sections: [] };
    const badge = render().match(/<span data-testid="primary-bot-badge"[^>]*>[\s\S]*?<\/span>/)?.[0] ?? "";
    expect(badge).toContain("width:16px;height:16px;right:0;bottom:0");
    expect(badge).toContain('width="8" height="8"');
    expect(badge).toContain("bg-primary-badge");
  });
});

describe("sections", () => {
  it("reads a team named My team in the interface's language", () => {
    fixture.state = { bots: [bot("atlas", { section: "My team" }), bot("iris", { section: "Ops" })], sections: ["My team", "Ops"] };
    const html = render();
    expect(html).toContain('data-section="Mon équipe"');
    expect(html).not.toContain('data-section="My team"');
    setLocale("en");
    expect(render()).toContain('data-section="My Team"');
    // any other name stays as typed
    expect(html).toContain('data-section="Ops"');
  });

  it("files the organization's library bots under Intégrés, after the teams", () => {
    fixture.state = {
      bots: [
        bot("atlas", { section: "My team" }),
        bot("forge", { installedPackage: { id: "designer", name: "Designer", release: "1.0.0", requiredApps: [], source: "org" } }),
        bot("filed", { section: "My team", installedPackage: { id: "x", name: "X", release: "1.0.0", requiredApps: [], source: "org" } }),
        bot("imported", { installedPackage: { id: "y", name: "Y", release: "1.0.0", requiredApps: [], source: "file" } }),
      ],
      sections: ["My team"],
    };
    const html = render();
    const builtIn = html.indexOf('data-sidebar-section-id="builtin:integrated"');
    expect(builtIn).toBeGreaterThan(html.indexOf('data-section="Mon équipe"'));
    expect(html).toContain('data-section="Intégrés"');
    expect(html.indexOf('data-sidebar-bot-row="forge"')).toBeGreaterThan(builtIn);
    // filed in a team, it stays there; a bot imported from a file is the person's
    expect(html.indexOf('data-sidebar-bot-row="filed"')).toBeLessThan(builtIn);
    expect(html.indexOf('data-sidebar-bot-row="imported"')).toBeLessThan(builtIn);
  });
});

describe("foot", () => {
  it("is the avatar then the Plugins pill; Browse bots left the avatar's menu for Plugins", () => {
    fixture.state = { bots: [bot("atlas")], sections: [] };
    const html = render();
    const foot = html.slice(html.indexOf("data-sidebar-foot"));
    expect(foot).toContain('data-test-account="avatar"');
    expect(foot.indexOf("data-test-account")).toBeLessThan(foot.indexOf("data-sidebar-connect-apps"));
    // the full name's pill, then the small Plugins pill (its words show
    // only when the profile is the avatar alone: SidebarFoot.test.ts)
    expect(foot).toContain('aria-label="Plugins"');
    expect(foot).not.toContain("data-sidebar-place=");
    expect(fixture.places.map((place) => place.key)).toEqual([]);
  });
});
