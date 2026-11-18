// @vitest-environment happy-dom
// The Team map as an org chart: the lead on top, teams as blocks placed by the
// work, four bots then "+N", links with their counts, the state on each bot,
// search with highlight, the team and state filters, a bot's popover and the
// detail column, the Sans équipe tray, keyboard moves and the phone layout.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { buildTeamMapPairs, buildTeamMapSections, type TeamMapSnapshot } from "@/lib/team-map";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), width: 1160, height: 840 }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: [], instances: [] }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/perspicax-org", () => ({ usePerspicaxOrg: () => null, loadPerspicaxOrg: async () => null }));
vi.mock("@/lib/environment-descriptor", () => ({ fetchEnvironmentDescriptor: async () => ({ ok: true, json: async () => ({ environmentId: "env-test" }) }) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
const exported = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/team-map-export", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/team-map-export")>();
  return { ...original, renderTeamMapPng: async () => { exported.calls += 1; return new Blob(["png"]); } };
});
const { TeamMapOrgChart } = await import("./TeamMapOrgChart");

class FakeObserver {
  constructor(private callback: () => void) {}
  observe(element: Element) {
    Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({ width: fixture.width, height: fixture.height, left: 0, top: 0, right: fixture.width, bottom: fixture.height, x: 0, y: 0, toJSON: () => ({}) }) });
    this.callback();
  }
  disconnect() {}
  unobserve() {}
}

const bot = (id: string, name: string, section: string, extra: Record<string, unknown> = {}): Bot => ({
  id, threadId: `${id}-chat`, name, title: id === "atlas" ? "Chief of staff" : `${name} role`, description: "", color: "blue", notifications: true, unread: false, messages: [],
  modelSelection: { instanceId: "fake", model: "test" }, tasks: [{ threadId: `${id}-chat`, title: "Chat", createdAt: 1 }], section, ...extra,
} as unknown as Bot);
const bots = [
  bot("atlas", "Atlas", "My team", { chiefOfStaff: true }), bot("boreas", "Boreas", "My team", { activity: "working", busy: true }), bot("cirrus", "Cirrus", "My team"), bot("delta", "Delta", "My team", { activity: "waiting-on-you" }),
  ...["echo", "fjord", "gale", "harbor", "iris"].map((id) => bot(id, id[0].toUpperCase() + id.slice(1), "Service desk")),
  bot("juno", "Juno", "Finance"), bot("kestrel", "Kestrel", "Finance"),
  bot("tide", "Tide", ""), bot("umber", "Umber", ""),
];
const now = Date.now();
const snapshot: TeamMapSnapshot = {
  handoffs: [
    { sourceBotId: "atlas", targetBotId: "boreas", count: 12, kind: "delegates", lastAt: now - 120_000 }, { sourceBotId: "atlas", targetBotId: "cirrus", count: 8, kind: "delegates", lastAt: now - 3_600_000 },
    { sourceBotId: "atlas", targetBotId: "juno", count: 5, kind: "delegates", lastAt: now - 7_200_000 }, { sourceBotId: "boreas", targetBotId: "echo", count: 9, kind: "delegates", lastAt: now - 60_000 },
    { sourceBotId: "echo", targetBotId: "fjord", count: 6, kind: "delegates", lastAt: now - 300_000 }, { sourceBotId: "delta", targetBotId: "cirrus", count: 3, kind: "reviews", lastAt: now - 90_000_000 },
    { sourceBotId: "juno", targetBotId: "kestrel", count: 14, kind: "delegates", lastAt: now - 1000 },
  ],
  collaborations: [], queued: [], running: [{ sourceBotId: "boreas", targetBotId: "echo", threadId: "echo-chat" }],
};

beforeAll(() => { setLocale("en"); });

describe("TeamMapOrgChart", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onMove = vi.fn(async () => true);
  const mount = async (width = 1160) => {
    fixture.width = width;
    const sections = buildTeamMapSections(bots, ["My team", "Service desk", "Finance"], {});
    await act(async () => {
      root.render(createElement(TeamMapOrgChart, {
        sections, pairs: buildTeamMapPairs(bots, snapshot), leadId: "atlas", canManage: true, onMove,
        onInstructions: vi.fn(), onEditTeam: vi.fn(), onDeleteTeam: vi.fn(),
      }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  const q = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
  const qa = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
  const type = async (selector: string, value: string) => {
    const input = q<HTMLInputElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };

  beforeEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeObserver;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    fixture.dispatch.mockClear();
    exported.calls = 0;
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it("draws the lead, one block per team and a card per visible bot, four then +N", async () => {
    await mount();
    expect(q("[data-bot-id=atlas]")).not.toBeNull();
    expect(qa("[data-team-key]").map((node) => node.dataset.teamKey).filter((key) => key)).toEqual(expect.arrayContaining(["My team", "Service desk", "Finance"]));
    const desk = q("[data-team-key='Service desk']")!;
    expect(["echo", "fjord", "gale", "harbor"].every((id) => q(`[data-bot-id=${id}]`))).toBe(true);
    expect(q("[data-bot-id=iris]")).toBeNull();
    expect(q("[data-team-more='Service desk']")?.textContent).toContain("+1 more");
    expect(desk.getAttribute("aria-label")).toBe("Service desk team");
  });

  it("opens +N to show every bot and closes it again", async () => {
    await mount();
    await click(q("[data-team-more='Service desk']")!);
    expect(q("[data-bot-id=iris]")).not.toBeNull();
    expect(q("[data-team-more='Service desk']")?.textContent).toContain("Show less");
    await click(q("[data-team-more='Service desk']")!);
    expect(q("[data-bot-id=iris]")).toBeNull();
  });

  it("draws the links with their counts on the links, and no count in the detail list", async () => {
    await mount();
    expect(q("[data-link='lead:My team']")).not.toBeNull();
    expect(q("[data-link-badge='lead:My team']")?.textContent).toBe("20");
    expect(q("[data-link-badge='lead:Finance']")?.textContent).toBe("5");
    expect(q("[data-link-badge^='team:']")?.textContent).toBe("9");
    expect(q("[data-link='team:My team\u0000Service desk']")?.getAttribute("data-link-state")).toBe("running");
    const review = qa("[data-link-badge^='bot:delta']");
    expect(review.map((node) => node.textContent)).toEqual(["3"]);
    const detail = q("[data-team-map-detail]")!;
    expect(detail.textContent).toContain("Busiest pairs");
    expect(detail.querySelectorAll("[data-pair]").length).toBe(5);
    expect(detail.textContent).not.toMatch(/\b14\b/);
  });

  it("shows each bot's live state from the store", async () => {
    await mount();
    expect(q("[data-bot-id=boreas] [data-state-dot]")?.getAttribute("data-state-dot")).toBe("working");
    expect(q("[data-bot-id=delta] [data-state-dot]")?.getAttribute("data-state-dot")).toBe("waiting");
    expect(q("[data-bot-id=delta]")?.textContent).toContain("Needs you");
    expect(q("[data-bot-id=cirrus] [data-state-dot]")?.getAttribute("data-state-dot")).toBe("idle");
  });

  it("opens a bot's popover next to its card with Open chat and Open page, and closes on Escape", async () => {
    await mount();
    await click(q("[data-bot-id=boreas]")!);
    const popover = q("[data-team-map-popover]")!;
    expect(popover.textContent).toContain("Boreas");
    expect(popover.textContent).toContain("Working");
    expect(popover.textContent).toContain("→ Echo");
    expect(popover.textContent).toContain("Open chat");
    expect(popover.textContent).toContain("Open page");
    await click([...popover.querySelectorAll("button")].find((button) => button.textContent === "Open page")!);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openPersonaEditor", botId: "boreas" });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(q("[data-team-map-popover]")).toBeNull();
  });

  it("the detail column follows the selection: a bot's received and sent handoffs", async () => {
    await mount();
    await click(q("[data-bot-id=echo]")!);
    const detail = q("[data-team-map-detail]")!;
    expect(detail.textContent).toContain("Received · 1");
    expect(detail.textContent).toContain("Sent · 1");
    expect(detail.querySelector("[data-pair='boreas:echo']")).not.toBeNull();
    expect(detail.querySelector("[data-pair='echo:fjord']")).not.toBeNull();
  });

  it("closes the detail column and the map keeps its size", async () => {
    await mount();
    await click(qa("[data-team-map-detail] button").find((button) => button.getAttribute("aria-label") === "Hide handoffs")!);
    expect(q("[data-team-map-detail]")).toBeNull();
    expect(q("[aria-pressed]")).not.toBeNull();
  });

  it("search highlights matches and dims the rest, and opens +N for a hidden match", async () => {
    await mount();
    await type("[data-team-map-search]", "iri");
    expect(q("[data-bot-id=iris]")).not.toBeNull();
    expect(q("[data-bot-id=iris]")?.className).toContain("ring-accent/30");
    expect(q("[data-bot-id=echo]")?.className).toContain("opacity-55");
    await type("[data-team-map-search]", "zzz");
    expect(host.textContent).toContain("No bot matches this search.");
  });

  it("the state filter keeps only the bots in that state", async () => {
    await mount();
    await click([...host.querySelectorAll<HTMLElement>("[aria-pressed]")].find((button) => button.textContent?.startsWith("Working"))!);
    expect(q("[data-bot-id=boreas]")).not.toBeNull();
    expect(q("[data-bot-id=cirrus]")).toBeNull();
    expect(q("[data-team-key='Finance']")).toBeNull();
  });

  it("the team filter is a searchable select that keeps only that team", async () => {
    await mount();
    await click(q("[data-team-map-team-filter]")!);
    const list = document.body.querySelector("[role=listbox]")!;
    expect(list).not.toBeNull();
    const search = list.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "fin");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const options = [...list.querySelectorAll("[role=option]")];
    expect(options.map((option) => option.textContent)).toEqual(["Finance2"]);
    await click(options[0]);
    expect(q("[data-team-key='Finance']")).not.toBeNull();
    expect(q("[data-team-key='Service desk']")).toBeNull();
  });

  it("Sans équipe is a tray of avatars that opens to cards", async () => {
    await mount();
    const tray = q("[data-team-tray]")!;
    expect(tray.textContent).toContain("Unassigned");
    expect(q("[data-team-key='']")?.querySelectorAll("[data-bot-id]").length).toBe(2);
    expect(q("[data-bot-id=tide]")?.className).toContain("rounded-full");
    await click(tray);
    expect(q("[data-bot-id=tide]")?.className).toContain("rounded-xl");
  });

  it("arrow keys move focus from bot to bot", async () => {
    await mount();
    const cirrus = q("[data-bot-id=cirrus]")!;
    cirrus.focus();
    const rects: Record<string, { top: number; left: number }> = { delta: { top: 100, left: 100 }, cirrus: { top: 160, left: 100 }, boreas: { top: 220, left: 100 } };
    for (const [id, at] of Object.entries(rects)) {
      Object.defineProperty(q(`[data-bot-id=${id}]`)!, "getBoundingClientRect", { configurable: true, value: () => ({ ...at, width: 190, height: 40, right: at.left + 190, bottom: at.top + 40, x: at.left, y: at.top, toJSON: () => ({}) }) });
    }
    await act(async () => { cirrus.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement).toBe(q("[data-bot-id=boreas]"));
    await act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    expect(document.activeElement).toBe(q("[data-bot-id=cirrus]"));
  });

  it("keeps every team's menu (add or move bots, instructions, memory, rename, delete) as a details, Unassigned's too", async () => {
    await mount();
    const summary = q("[data-team-key='Finance'] summary")!;
    expect(summary.getAttribute("aria-label")).toBe("Manage Finance team");
    const menu = summary.parentElement!.querySelector("[role=menu]")!;
    expect(menu.querySelectorAll("[role=menuitem]").length).toBeGreaterThanOrEqual(4);
    expect(menu.querySelector("[aria-label^='Move bots to']")).not.toBeNull();
    expect(q("[data-team-key=''] summary")?.getAttribute("aria-label")).toBe("Manage Unassigned team");
    expect(q("[data-team-key=''] [role=menu] [role=menuitem][aria-label*='Rename']")).toBeNull();
  });

  it("exports the map as an image from the More menu", async () => {
    const create = vi.fn(() => "blob:map"), revoke = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revoke;
    await mount();
    await click(q("[data-team-map-more]")!);
    const item = [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((node) => node.textContent === "Export image")!;
    await click(item);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(exported.calls).toBe(1);
    expect(create).toHaveBeenCalled();
  });

  it("the More menu holds the legend, the gesture hint, the minimap and the keyboard keys", async () => {
    await mount();
    await click(q("[data-team-map-more]")!);
    const menu = document.body.querySelector("[role=menu][aria-label='More']")!;
    expect(menu.textContent).toContain("Legend");
    expect(menu.textContent).toContain("Drag within a team to arrange");
    expect(menu.textContent).toContain("Minimap");
    expect(menu.textContent).toContain("Keyboard");
  });

  it("at phone width it stacks the teams with connectors and lists the busiest handoffs inline", async () => {
    await mount(390);
    expect(q("[data-team-map-mobile]")).not.toBeNull();
    expect(q("[data-bot-id=atlas]")).not.toBeNull();
    expect(qa("[data-mobile-link]").length).toBeGreaterThan(2);
    expect(q("[data-team-map-detail]")?.textContent).toContain("Busiest pairs");
    await click(q("[data-bot-id=boreas]")!);
    expect(q("[data-team-map-popover]")?.textContent).toContain("Boreas");
  });
});
