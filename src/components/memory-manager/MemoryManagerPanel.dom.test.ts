// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { windowChrome: "default", host: { label: "Test" } } }),
  useCaptionChrome: () => ({ dragProps: {}, controlsShiftStyle: undefined, padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));

const confirmAsync = vi.fn(async () => true);
vi.mock("../ConfirmProvider", () => ({
  confirmAsync: (...args: unknown[]) => confirmAsync(...(args as [])),
  useConfirm: () => vi.fn(async () => true),
  discardConfirmRequest: (body?: string) => ({ title: "Discard", body }),
}));

// The markdown renderer is the chat's: a plain stand-in keeps this suite on the page.
vi.mock("../ChatMarkdown", () => ({
  ChatMarkdown: ({ text }: { text: string }) => createElement("div", { "data-chat-markdown": "" }, text),
}));

const calls: Array<{ path: string; method: string; body?: string }> = [];
const now = Date.now();

vi.mock("@/state/store", async () => {
  const actual = await vi.importActual<typeof import("@/state/store")>("@/state/store");
  return {
    ...actual,
    useStore: () => ({
      state: { ...actual.initialState, activeView: "memory", memoryManagerOpen: true },
      dispatch: vi.fn(),
    }),
    useStoreOptional: () => null,
    api: vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      // `wide`: every kind of row (a team section, a team tier, a proposal).
      const wide = (globalThis as { __memoryWide?: boolean }).__memoryWide === true;
      if (path === "/api/memory-manager/sources") {
        return {
          sources: [
            { id: "bot:atlas", kind: "bot", name: "Atlas", detail: "Bot memory", mayWrite: true, botId: "atlas" },
            // A bot the memory routes refuse (an older server still lists it).
            { id: "bot:alubar", kind: "bot", name: "Alubar", detail: "Bot memory", mayWrite: true, botId: "alubar" },
            ...(wide ? [{ id: "team:general", kind: "team", name: "General", detail: "1 team note", mayWrite: true, section: "" }] : []),
            { id: "perspicax", kind: "perspicax", name: "Perspicax", mayWrite: true, mayManage: true, scope: "me" },
          ],
          perspicax: { available: true },
        };
      }
      if (path.startsWith("/api/bots/alubar/")) throw new actual.ApiError("no such bot", 404);
      if (path.startsWith("/api/team-memory")) {
        if (init?.method && init.method !== "GET") return {};
        return { entries: [{ id: "tm1", kind: "term", name: "OMB", detail: "Open MAUS Bot", status: "proposed", updatedAt: now, source: { botId: "atlas", botName: "Atlas", threadId: "t", at: now - 1000 } }] };
      }
      if (path.startsWith("/api/bots/atlas/memory/journal")) {
        return { entries: [
          { id: "j1", at: now - 40 * 86_400_000, botId: "atlas", path: "memory/dining.md", actor: "bot", via: "turn", kind: "created", beforeHash: null, afterHash: "a", diff: "", added: 3, removed: 0, canRevert: true },
          { id: "j2", at: now - 3_600_000, botId: "atlas", path: "memory/dining.md", actor: "person", via: "panel", kind: "edited", beforeHash: "a", afterHash: "b", diff: "", added: 1, removed: 0, canRevert: true },
        ] };
      }
      if (path.startsWith("/api/bots/atlas/memory") && !path.includes("/file")) {
        return {
          botId: "atlas",
          workspacePath: "/tmp",
          index: { lines: 0, bytes: 0, maxLines: 200, maxBytes: 24000, loadedLines: 0, loadedBytes: 0, truncated: false, hash: "h" },
          topics: [
            { path: "memory/dining.md", name: "Dining.md", bytes: 12, modifiedAt: now - 3_600_000 },
            { path: "memory/travel.md", name: "Travel.md", bytes: 8, modifiedAt: now - 7_200_000 },
          ],
          logs: [],
        };
      }
      if (path.includes("/memory/file")) {
        if (path.includes("travel")) return { path: "memory/travel.md", text: "# Travel\n\nTrains with [[Dining]].\n", hash: "t", exists: true };
        if (path.includes("MEMORY")) return { path: "MEMORY.md", text: "# MEMORY\n\nIndex.\n", hash: "m", exists: true };
        return { path: "memory/dining.md", text: "# Dining\n\nSee [[Travel]].\n\n```json\n{\"likes\":\"pasta\"}\n```\n", hash: "abc", exists: true };
      }
      if (path.startsWith("/api/me/memory/tree")) {
        return {
          tiers: [{
            scope: "me", kind: "me", name: "Personal", may_write: true, may_manage: true, trashed: 0,
            topics: [{ topic: "notes", count: 1, entries: [{ id: "n1", title: "Brief", topic: "notes", tags: ["work", "area:plan"], excerpt: "Keep", author_name: "Dana Reyes", created: new Date(now - 5 * 86_400_000).toISOString(), updated: new Date(now - 7_200_000).toISOString() }] }],
          }, ...(wide ? [{
            scope: "team:ops", kind: "team", name: "Ops", may_write: true, may_manage: false, trashed: 0,
            topics: [{ topic: "runbooks", count: 1, entries: [{ id: "n2", title: "Runbook", topic: "runbooks", tags: [], excerpt: "{\"steps\":3,\"owner\":\"ops\"}" }] }],
          }] : [])],
        };
      }
      if (path.startsWith("/api/me/memory/tags")) return { namespaces: [{ id: "area", label_en: "Area", controlled: true, required: false, tags: [{ tag: "area:network" }] }] };
      if (path.startsWith("/api/me/memory/archived")) return { notes: [] };
      if (path.startsWith("/api/me/memory/trash")) return { notes: [], days: 30 };
      if (path.startsWith("/api/me/memory/entry")) {
        return {
          id: "n1", scope: "me", topic: "notes", title: "Brief", body: "# Brief\n", tags: ["work"], may_edit: true, version: 1,
          author_name: "Dana Reyes", created: new Date(now - 5 * 86_400_000).toISOString(), updated: new Date(now - 7_200_000).toISOString(),
          source: "humain", provenance: [{ kind: "console", reference: "" }], versions: 3, edit_mode: "direct",
          links_out: [], backlinks: [{ scope: "me", id: "n9", title: "Plan", context: "See the Brief first." }],
        };
      }
      if (path.startsWith("/api/me/memory/bulk")) return { action: "delete", done: 1, review: 0, refused: 0, items: [], batch: "b1" };
      return {};
    }),
  };
});

vi.mock("../panel-slot", () => ({
  usePanelSlot: () => null,
  PanelSlotProvider: ({ children }: { children: unknown }) => children,
}));

import { setLocale } from "@/lib/i18n";
import { MemoryManagerPanel } from "./MemoryManagerPanel";

const settle = async () => { await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }); };
const wait = async (ms = 20) => { await act(async () => { await new Promise((done) => setTimeout(done, ms)); }); };

describe("MemoryManagerPanel page", () => {
  let host: HTMLDivElement;
  let root: Root;
  let viewport = 1440;

  beforeEach(() => {
    viewport = 1440;
    calls.length = 0;
    confirmAsync.mockClear();
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return { matches: min ? viewport >= Number(min[1]) : false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList;
    });
    setLocale("en");
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (globalThis as { __memoryWide?: boolean }).__memoryWide;
    vi.restoreAllMocks();
  });

  const render = async () => {
    await act(async () => { root.render(createElement(MemoryManagerPanel)); });
    await settle();
    await wait();
    await settle();
  };
  const segment = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("[data-memory-views] button")).find((button) => button.textContent?.includes(label))!;

  it("is a full page with the console's views under the title and the explorer on the LEFT", async () => {
    await render();
    expect(host.querySelector("[data-memory-manager-page]")).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("[data-memory-header] h1")?.textContent).toBe("Memory");
    expect(Array.from(host.querySelectorAll("[data-memory-views] button")).map((button) => button.textContent)).toEqual(["Notes", "Map", "Tags", "Quality"]);
    expect(host.querySelector("[data-memory-create]")?.textContent).toContain("New note");
    const body = host.querySelector("[data-memory-row] .content-card-body")!;
    expect(body.children[0]!.hasAttribute("data-memory-sources")).toBe(true);
    expect(body.children[1]!.tagName).toBe("SECTION");
    expect(host.querySelector("[data-memory-sources]")!.className).toContain("border-r");
    expect(host.querySelector("[data-memory-sources]")!.className).toContain("w-[236px]");
  });

  it("Notes: lists, tiers and tidy up like the Perspicax explorer, with real counts only", async () => {
    await render();
    const lists = Array.from(host.querySelectorAll("[data-memory-nav-list] [data-memory-nav]")).map((node) => node.getAttribute("data-memory-nav"));
    expect(lists).toEqual(["all", "pinned", "recent", "review"]);
    expect(host.querySelector('[data-memory-nav="all"]')?.textContent).toContain("4");
    expect(Array.from(host.querySelectorAll("[data-memory-tidy-list] [data-memory-nav]")).map((node) => node.getAttribute("data-memory-nav"))).toEqual(["archived", "trash"]);
    const mine = host.querySelector('[data-memory-tier="mine"]') as HTMLElement;
    expect(mine.textContent).toContain("My memory");
    expect(mine.textContent).toContain("4");
    // The bot is a folder of My memory.
    expect(host.querySelector('[data-memory-source="bot:atlas"]')?.textContent).toContain("Atlas");
    expect(host.querySelector('[data-memory-source="bot:atlas"]')?.textContent).not.toContain("Bot memory");
    const folder = host.querySelector('[data-memory-folder="me/notes"]')!.closest("div")!;
    expect(Array.from(folder.querySelectorAll("[data-memory-row-action]")).map((node) => node.getAttribute("data-memory-row-action"))).toEqual(["new", "rename", "delete"]);
    // The list card, its toolbar and its rows.
    expect(host.querySelector("[data-memory-list-title]")?.textContent).toBe("All notes");
    expect(host.querySelector("[data-memory-list-count]")?.textContent).toBe("4 of 4");
    expect(host.querySelectorAll('[data-memory-nav-view="all"] [data-memory-note-row]').length).toBe(4);
    const brief = host.querySelector('[data-memory-row-key="perspicax|me/n1"]')!;
    expect(brief.textContent).toContain("Dana Reyes");
    expect(brief.textContent).toContain("work");
    // A bot note: its author from the journal, its excerpt from its body.
    const dining = host.querySelector('[data-memory-row-key="bot:atlas|memory/dining.md"]')!;
    expect(dining.textContent).toContain("You");
    expect(dining.textContent).toContain("Atlas / Topics");
    expect(host.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("Notes: the search keeps the notes that match, operators included", async () => {
    await render();
    const input = host.querySelector("[data-memory-search]") as HTMLInputElement;
    const type = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("brief");
    expect(host.querySelectorAll("[data-memory-note-row]").length).toBe(1);
    await type("tag:work");
    expect(host.querySelectorAll("[data-memory-note-row]").length).toBe(1);
    await type("folder:topics");
    expect(host.querySelectorAll("[data-memory-note-row]").length).toBe(2);
  });

  it("Notes: a bot folder lists its notes and deletes several at once", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-source="bot:atlas"]') as HTMLButtonElement).click(); });
    await settle();
    expect(host.querySelector("[data-memory-list-title]")?.textContent).toBe("Atlas");
    expect(host.querySelectorAll("[data-memory-note-row]").length).toBe(3);
    await act(async () => { (host.querySelector("[data-memory-select-all]") as HTMLInputElement).click(); });
    expect(host.querySelector("[data-memory-bulk]")?.textContent).toContain("3 selected");
    await act(async () => { (host.querySelector("[data-memory-bulk-delete]") as HTMLButtonElement).click(); });
    await settle();
    expect(confirmAsync).toHaveBeenCalled();
    expect(calls.filter((call) => call.method === "DELETE" && call.path.includes("/api/bots/atlas/memory/file")).length).toBe(3);
  });

  it("Note detail: a page with its properties and backlinks, Edit opens the editor", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-row-key="perspicax|me/n1"] [data-memory-row-open]') as HTMLButtonElement).click(); });
    await wait();
    await settle();
    const page = host.querySelector("[data-memory-note]")!;
    expect(page).not.toBeNull();
    expect(page.querySelector("[data-memory-note-back]")?.textContent).toContain("Memory");
    expect(page.querySelector("[data-memory-note-line]")?.textContent).toContain("My memory / notes");
    expect(page.querySelector("[data-memory-note-line]")?.textContent).toContain("by Dana Reyes");
    const props = page.querySelector("[data-memory-note-props]")!.textContent!;
    for (const label of ["Tier", "Author", "Created", "Changed", "Provenance", "Source", "Versions"]) expect(props).toContain(label);
    expect(props).toContain("3 versions");
    expect(page.querySelector("[data-memory-note-backlinks]")?.textContent).toContain("Plan");
    expect(page.querySelector("[data-memory-note-toolbar]")?.textContent).toContain("Neighbourhood");
    await act(async () => { (page.querySelector("[data-memory-note-edit]") as HTMLButtonElement).click(); });
    expect(host.querySelector("[data-memory-rename]")).not.toBeNull();
    expect(host.querySelector("[data-memory-tags]")).not.toBeNull();
    await act(async () => { (host.querySelector("[data-memory-note-back]") as HTMLButtonElement).click(); });
    expect(host.querySelector("[data-memory-list]")).not.toBeNull();
  });

  it("Note detail: a bot note folds its JSON block and counts its versions from the journal", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-row-key="bot:atlas|memory/dining.md"] [data-memory-row-open]') as HTMLButtonElement).click(); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-read-body]")).not.toBeNull();
    expect(host.querySelector("[data-memory-json-tree]")).not.toBeNull();
    expect(host.querySelector("[data-memory-note-props]")?.textContent).toContain("2 versions");
    // Travel links to [[Dining]]: a backlink.
    expect(host.querySelector("[data-memory-note-backlinks]")?.textContent).toContain("Travel");
  });

  it("Map: the console's chrome around Sagax's map, a note opens from it", async () => {
    await render();
    await act(async () => { segment("Map").click(); });
    await settle();
    expect(host.querySelector("[data-memory-sources]")).toBeNull();
    expect(host.querySelector("[data-memory-map-search]")?.getAttribute("placeholder")).toBe("Find on the map");
    expect(host.querySelector('[data-memory-map-tier="mine"]')?.textContent).toContain("4");
    expect(host.querySelector("[data-memory-map-count]")?.textContent).toMatch(/^4 notes, \d+ links/);
    expect(host.querySelector("[data-memory-map-timeline]")?.textContent).toContain("Today · 4 notes");
    const note = host.querySelector('[data-memory-map-node="note"]') as HTMLButtonElement;
    await act(async () => { note.click(); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-note]")).not.toBeNull();
  });

  it("Tags: the tiles from the vocabulary and the notes, the most used and the free tags", async () => {
    await render();
    await act(async () => { segment("Tags").click(); });
    await settle();
    const tiles = Array.from(host.querySelectorAll("[data-memory-stat]")).map((node) => node.getAttribute("data-memory-stat"));
    expect(tiles).toEqual(["namespaces", "values", "free", "orphans"]);
    expect(host.querySelector('[data-memory-stat="free"]')?.textContent).toContain("1");
    expect(host.querySelector('[data-memory-stat="orphans"]')?.textContent).toContain("1");
    expect(host.querySelector("[data-memory-tags-orphans]")?.textContent).toContain("area:plan");
    expect(host.querySelector("[data-memory-tags-top]")?.textContent).toContain("work");
    await act(async () => { (host.querySelector('[data-memory-tags-free-chip="work"]') as HTMLButtonElement).click(); });
    await settle();
    expect((host.querySelector("[data-memory-search]") as HTMLInputElement).value).toBe("tag:work");
    expect(host.querySelectorAll("[data-memory-note-row]").length).toBe(1);
  });

  it("Quality: Health counts what Sagax holds, Journal lists the bots' changes", async () => {
    await render();
    await act(async () => { segment("Quality").click(); });
    await settle();
    expect(Array.from(host.querySelectorAll("[data-memory-stat]")).map((node) => node.getAttribute("data-memory-stat"))).toEqual(["active", "review", "aging", "duplicates", "orphans"]);
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).toContain("4");
    expect(host.querySelector("[data-memory-quality-area]")).not.toBeNull();
    expect(host.querySelector("[data-memory-quality-bars]")).not.toBeNull();
    const journal = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-memory-quality-tabs] button")).find((button) => button.textContent === "Journal")!;
    await act(async () => { journal.click(); });
    expect(host.querySelectorAll("[data-memory-journal-row]").length).toBe(2);
  });

  it("folds the explorer under 1024px, and Cmd+O opens it with the quick switcher", async () => {
    viewport = 900;
    await render();
    expect(host.querySelector("[data-memory-sources]")).toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", metaKey: true, ctrlKey: true })); });
    await wait(30);
    expect(host.querySelector("[data-memory-sources]")).not.toBeNull();
    expect(host.querySelector("[data-memory-switcher]")).not.toBeNull();
    expect(host.querySelectorAll("[data-memory-switcher-hit]").length).toBeGreaterThan(0);
  });

  // 2026-11-02: selecting a bot the memory routes refuse showed a red
  // "no such bot" under the header. Such a bot leaves the page, and no
  // row of the explorer ends on an error.
  it("never shows an error for any row of the explorer", async () => {
    (globalThis as { __memoryWide?: boolean }).__memoryWide = true;
    await render();
    expect(host.querySelector('[data-memory-source="bot:alubar"]')).toBeNull();
    expect(host.textContent).not.toContain("Alubar");
    expect(Array.from(host.querySelectorAll("[data-memory-nav]")).map((node) => node.getAttribute("data-memory-nav"))).toEqual(["all", "teams", "pinned", "recent", "review", "archived", "trash"]);
    // A JSON excerpt reads in words.
    expect(host.querySelector('[data-memory-row-key="perspicax|team:ops/n2"]')?.textContent).toContain("JSON · 2 keys: steps, owner");
    const rows = [
      '[data-memory-nav="all"]', '[data-memory-nav="teams"]', '[data-memory-nav="review"]', '[data-memory-nav="trash"]',
      '[data-memory-tier="mine"]',
      '[data-memory-source="bot:atlas"]',
      '[data-memory-folder="me/notes"]',
      '[data-memory-tier="team:general"]',
      '[data-memory-folder="team:general/term"]',
      '[data-memory-tier="perspicax:team:ops"]',
    ];
    for (const selector of rows) {
      const row = host.querySelector(selector) as HTMLButtonElement | null;
      expect(row, selector).not.toBeNull();
      await act(async () => { row!.click(); });
      await settle();
      expect(host.querySelector('[role="alert"]'), selector).toBeNull();
      expect(host.textContent, selector).not.toContain("no such bot");
    }
    await act(async () => { (host.querySelector('[data-memory-nav="review"]') as HTMLButtonElement).click(); });
    expect(host.querySelectorAll("[data-memory-note-row]").length).toBe(1);
  });
});
