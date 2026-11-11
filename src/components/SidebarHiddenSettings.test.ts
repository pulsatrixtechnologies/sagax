// @vitest-environment happy-dom
// #3576: Settings > Appearance > Hidden from the sidebar is the one place
// that lists the hidden entries (the sidebar draws nothing for them): each
// bot or group with its kind and a Show that brings it back. Search still
// finds and opens a hidden bot.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  bots: [] as unknown[],
  groups: [] as unknown[],
}));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: fixture.bots, groups: fixture.groups, config: null } }),
}));
vi.mock("@/lib/perspicax-org", () => ({ useOrgPeople: () => new Map([["pr_ada", { name: "Ada Example", login: "ada" }]]) }));
vi.mock("@/lib/viewer", () => ({ viewerActorId: () => "pr_me" }));

const { SidebarHiddenSettings } = await import("./SidebarHiddenSettings");
const { DEFAULT_SIDEBAR_HIDDEN, hiddenKeySet, readSidebarHidden, writeSidebarHidden } = await import("@/lib/sidebar-hidden");
const { setLocale } = await import("@/lib/i18n");
const { buildPaletteSections } = await import("@/lib/palette-commands");

let host: HTMLDivElement;
let root: Root;

const render = () => act(() => root.render(createElement(SidebarHiddenSettings)));
const entryRows = () => [...host.querySelectorAll<HTMLElement>("[data-settings-hidden-entry]")];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLocale("en");
  localStorage.clear();
  writeSidebarHidden(DEFAULT_SIDEBAR_HIDDEN);
  fixture.bots = [
    { id: "server", name: "Server", messages: [] } as unknown as Bot,
    { id: "tester", name: "Tester", messages: [] } as unknown as Bot,
  ];
  fixture.groups = [
    { id: "reviewers", name: "Reviewers", messages: [] } as unknown as Group,
    { id: "dm", name: "dm", peopleDm: true, humanIds: ["pr_me", "pr_ada"], messages: [] } as unknown as Group,
  ];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  writeSidebarHidden(DEFAULT_SIDEBAR_HIDDEN);
});

describe("Settings > Appearance > Hidden from the sidebar (#3576)", () => {
  it("lists each hidden bot and group with its kind and a Show that brings it back to the sidebar", () => {
    writeSidebarHidden({
      ...DEFAULT_SIDEBAR_HIDDEN,
      items: [
        { kind: "bot", id: "tester", at: 1 },
        { kind: "group", id: "reviewers", at: 2 },
        { kind: "person", id: "pr_ada", at: 3 },
      ],
    });
    render();
    const rows = entryRows();
    expect(rows.map((row) => row.dataset.settingsHiddenEntry)).toEqual(["group:reviewers", "bot:tester"]);
    expect(rows[1]!.textContent).toContain("Tester");
    expect(rows[1]!.textContent).toContain("Bot");
    expect(rows[0]!.textContent).toContain("Reviewers");
    expect(rows[0]!.textContent).toContain("Group");
    // a closed person conversation is not listed, as before
    expect(host.textContent).not.toContain("Ada Example");
    // the grey line no longer sends the person to the sidebar
    expect(host.textContent).not.toContain("foot of the sidebar");

    const show = rows[1]!.querySelector<HTMLButtonElement>('button[aria-label="Show Tester in the sidebar"]');
    expect(show?.textContent).toBe("Show");
    act(() => show!.click());
    expect(hiddenKeySet(readSidebarHidden()).has("bot:tester")).toBe(false);
    expect(hiddenKeySet(readSidebarHidden()).has("group:reviewers")).toBe(true);
    expect(entryRows().map((row) => row.dataset.settingsHiddenEntry)).toEqual(["group:reviewers"]);
  });

  it("says nothing is hidden, and keeps the two switches", () => {
    writeSidebarHidden({ ...DEFAULT_SIDEBAR_HIDDEN, items: [{ kind: "person", id: "pr_ada", at: 1 }] });
    render();
    expect(entryRows()).toHaveLength(0);
    expect(host.textContent).toContain("Right-click a bot or a group to hide it");
    expect(host.textContent).toContain("Show people again when they write");
    expect(host.textContent).toContain("Show bots again when they post");
  });

  it("leaves a hidden bot to search, which finds and opens it", () => {
    writeSidebarHidden({ ...DEFAULT_SIDEBAR_HIDDEN, items: [{ kind: "bot", id: "tester", at: 1 }] });
    const sections = buildPaletteSections({
      bots: fixture.bots as Bot[], groups: [], query: "Tester", messageHits: [], recents: [],
      isMac: true, desktop: true, canCreateBots: true, advanced: true,
    });
    const hit = sections.flatMap((section) => section.items).find((item) => item.action.kind === "bot" && item.action.bot.id === "tester");
    expect(hit).toBeTruthy();
  });
});
