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
      // `links`: a temporary agent's memory no bot is linked to, a sidebar section without team notes.
      const links = (globalThis as { __memoryLinks?: boolean }).__memoryLinks === true;
      if (path === "/api/memory-manager/sources") {
        return {
          sources: [
            { id: "bot:atlas", kind: "bot", name: "Atlas", detail: "Bot memory", mayWrite: true, botId: "atlas", linked: true },
            ...(links ? [
              { id: "bot:perf", kind: "bot", name: "perf-test-061", detail: "Bot memory", mayWrite: true, botId: "perf", linked: false },
              { id: "team:general", kind: "team", name: "General", detail: "1 team note", mayWrite: true, section: "" },
              { id: "team:dr-eggbot", kind: "team", name: "dr eggbot", detail: "0 team notes", mayWrite: true, section: "dr-eggbot" },
            ] : []),
            // A bot the memory routes refuse (an older server still lists it).
            { id: "bot:northwind", kind: "bot", name: "Northwind", detail: "Bot memory", mayWrite: true, botId: "northwind" },
            ...(wide ? [{ id: "team:general", kind: "team", name: "General", detail: "1 team note", mayWrite: true, section: "" }] : []),
            { id: "perspicax", kind: "perspicax", name: "Perspicax", mayWrite: true, mayManage: true, scope: "me" },
          ],
          perspicax: { available: true },
        };
      }
      if (path.startsWith("/api/bots/northwind/")) throw new actual.ApiError("no such bot", 404);
      // #3106 `review`: two Perspicax teams with their queues, a team-memory proposal; decisions stick.
      const review = (globalThis as { __memoryReview?: Set<string> }).__memoryReview;
      if (review && path.startsWith("/api/me/memory/reviews/") && init?.method === "POST") {
        review.add(path.split("/")[5]!);
        return {};
      }
      if (review && path.startsWith("/api/team-memory/tm1") && init?.method && init.method !== "GET") {
        review.add("tm1");
        return {};
      }
      if (review && path.startsWith("/api/team-memory")) {
        return { entries: review.has("tm1") ? [] : [{ id: "tm1", kind: "term", name: "OMB", detail: "Open MAUS Bot", status: "proposed", updatedAt: now, source: { botId: "atlas", botName: "Atlas", threadId: "t", at: now - 1000 } }] };
      }
      if (review && path.startsWith("/api/me/memory/tree")) {
        const pending = (items: Array<{ review_id: string; title: string; may_decide: boolean }>) => items
          .filter((item) => !review.has(item.review_id))
          .map((item) => ({ ...item, kind: "new", topic: "dispatch", risky: false, mine: false, created: new Date(now - 60_000).toISOString() }));
        return {
          tiers: [
            { scope: "me", kind: "me", name: "Personal", may_write: true, may_manage: true, trashed: 0, topics: [] },
            { scope: "org", kind: "org", name: "Organization", may_write: false, may_manage: false, trashed: 0, topics: [] },
            {
              scope: "team:7", kind: "team", name: "Équipe terrain", may_write: true, may_manage: false, trashed: 0,
              pending: pending([{ review_id: "r1", title: "Night shift rule", may_decide: true }]),
              topics: [{ topic: "dispatch", count: 1, entries: [{ id: "n7", title: "Board order", topic: "dispatch", tags: [], excerpt: "Urgent first" }] }],
            },
            {
              scope: "team:9", kind: "team", name: "Back office", may_write: true, may_manage: false, trashed: 0,
              pending: pending([{ review_id: "r2", title: "Invoice wording", may_decide: false }]),
              topics: [{ topic: "billing", count: 1, entries: [{ id: "n9", title: "Invoice QC", topic: "billing", tags: [], excerpt: "Check" }] }],
            },
          ],
        };
      }
      if (path.startsWith("/api/team-memory") && path.includes("section=dr-eggbot")) return { entries: [] };
      if (path.startsWith("/api/bots/perf/memory/journal")) return { entries: [] };
      if (path.startsWith("/api/bots/perf/memory") && init?.method === "DELETE") return { ok: true };
      if (path.startsWith("/api/bots/perf/memory") && !path.includes("/file")) {
        return {
          botId: "perf", workspacePath: "/tmp/perf",
          index: { lines: 0, bytes: 0, maxLines: 200, maxBytes: 24000, loadedLines: 0, loadedBytes: 0, truncated: false, hash: "h" },
          topics: [{ path: "memory/probe.md", name: "probe.md", bytes: 5, modifiedAt: now - 3_600_000 }],
          logs: [],
        };
      }
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
            topics: [{ topic: "notes", count: 2, entries: [
              { id: "n1", title: "Brief", topic: "notes", tags: ["work", "area:plan"], excerpt: "Keep", author_name: "Dana Reyes", created: new Date(now - 5 * 86_400_000).toISOString(), updated: new Date(now - 7_200_000).toISOString(), rank: 1 },
              { id: "n3", title: "Agenda", topic: "notes", tags: [], excerpt: "Monday", author_name: "Dana Reyes", updated: new Date(now - 9 * 86_400_000).toISOString(), rank: 0 },
            ] }],
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
      // audit N-6: many collections, each detail answered a little later
      const many = (globalThis as { __memoryMany?: { inflight: number; max: number } }).__memoryMany;
      if (many && path === "/api/me/memory/collections" && init?.method !== "POST") {
        return { collections: Array.from({ length: 10 }, (_, n) => ({ id: `c${n + 1}`, scope: "me", title: `Book ${n + 1}`, description: "", author_name: "Dana Reyes", item_count: 1, may_edit: true })) };
      }
      if (many && path.startsWith("/api/me/memory/collections/")) {
        many.inflight += 1;
        many.max = Math.max(many.max, many.inflight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        many.inflight -= 1;
        const id = path.split("/").at(-1)!;
        return { id, scope: "me", title: id, description: "", item_count: 1, may_edit: true, items: [{ note_scope: "me", note_id: "n1", rank: 0, title: "Brief", topic: "notes", readable: true }] };
      }
      if (path === "/api/me/memory/collections") {
        if (init?.method === "POST") return { id: "c2", scope: "me", title: "New", description: "", item_count: 0, may_edit: true, items: [] };
        return { collections: [{ id: "c1", scope: "me", title: "Onboarding book", description: "Read in order", author_name: "Dana Reyes", item_count: 1, may_edit: true }] };
      }
      if (path.startsWith("/api/me/memory/collections/")) {
        return { id: "c1", scope: "me", title: "Onboarding book", description: "Read in order", item_count: 1, may_edit: true, items: [{ note_scope: "me", note_id: "n1", rank: 0, title: "Brief", topic: "notes", readable: true }] };
      }
      if (path.startsWith("/api/me/memory/order")) return {};
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
    delete (globalThis as { __memoryLinks?: boolean }).__memoryLinks;
    delete (globalThis as { __memoryReview?: Set<string> }).__memoryReview;
    vi.restoreAllMocks();
  });

  const render = async () => {
    await act(async () => { root.render(createElement(MemoryManagerPanel)); });
    await settle();
    await wait();
    await settle();
  };
  const segment = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("[data-memory-views] button")).find((button) => button.textContent?.includes(label))!;
  // The map opens on Graph since the Obsidian-like view; the scope tests read the radial brain's node count.
  const radial = async () => {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-memory-map-layout-switch] button")).find((b) => b.textContent === "Radial");
    if (button) await act(async () => { button.click(); });
  };

  it("is a full page with the console's views under the title and the explorer as the RIGHT rail", async () => {
    await render();
    expect(host.querySelector("[data-memory-manager-page]")).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("[data-memory-header] h1")?.textContent).toBe("Memory");
    // The Tools page standard (Team map, 2026-11-06): icon, 17px title, count, subtitle.
    expect(host.querySelector("[data-memory-header] h1")?.className).toContain("text-[17px]");
    expect(host.querySelector("[data-memory-header] [data-page-title] svg")).not.toBeNull();
    expect(host.querySelector("[data-memory-header] [data-page-count]")?.textContent).toMatch(/notes?$/);
    expect(host.querySelector("[data-memory-header] [data-page-subtitle]")?.textContent).toBe("What your bots remember, by note, map, tag and quality.");
    // the views and the scope chip sit in the toolbar row under the title
    expect(host.querySelector("[data-memory-header] [data-page-toolbar] [data-memory-views]")).not.toBeNull();
    // "+ New note" is the outlined action, never the filled brown one
    expect(host.querySelector("[data-memory-create]")?.className).toContain("border-hairline/50");
    expect(host.querySelector("[data-memory-create]")?.className).not.toContain("bg-accent");
    expect(Array.from(host.querySelectorAll("[data-memory-views] button")).map((button) => button.textContent)).toEqual(["Notes", "Map", "Tags", "Quality"]);
    expect(host.querySelector("[data-memory-create]")?.textContent).toContain("New note");
    const body = host.querySelector("[data-memory-row] .content-card-body")!;
    // the owner 2026-11-03: the content first, the explorer on its right, as Automations' calendar rail.
    expect(body.children[0]!.tagName).toBe("SECTION");
    const rail = body.children[body.children.length - 1]!;
    expect(rail.hasAttribute("data-memory-sources")).toBe(true);
    expect(rail.hasAttribute("data-right-rail")).toBe(true);
    expect(rail.className).toContain("w-[280px]");
    expect(rail.className).toContain("border-l");
    expect(rail.className).not.toContain("border-r");
    // The "›" sits at its top-left, in its own row above "Open a note".
    const hide = rail.querySelector("[data-right-rail-hide]")!;
    expect(hide).not.toBeNull();
    expect(rail.children[0]!.contains(hide)).toBe(true);
    expect(rail.children[0]!.querySelector("[data-memory-switcher-open]")).toBeNull();
    expect(hide.querySelector("svg")?.getAttribute("class")).toContain("chevron-right");
  });

  it("Notes: lists, tiers and tidy up like the Perspicax explorer, with real counts only", async () => {
    await render();
    const lists = Array.from(host.querySelectorAll("[data-memory-nav-list] [data-memory-nav]")).map((node) => node.getAttribute("data-memory-nav"));
    expect(lists).toEqual(["all", "pinned", "recent", "review"]);
    expect(host.querySelector('[data-memory-nav="all"]')?.textContent).toContain("5");
    expect(Array.from(host.querySelectorAll("[data-memory-tidy-list] [data-memory-nav]")).map((node) => node.getAttribute("data-memory-nav"))).toEqual(["collections", "archived", "trash", "import"]);
    const mine = host.querySelector('[data-memory-tier="mine"]') as HTMLElement;
    expect(mine.textContent).toContain("My memory");
    expect(mine.textContent).toContain("5");
    // The bot is a folder of My memory.
    expect(host.querySelector('[data-memory-source="bot:atlas"]')?.textContent).toContain("Atlas");
    expect(host.querySelector('[data-memory-source="bot:atlas"]')?.textContent).not.toContain("Bot memory");
    const folder = host.querySelector('[data-memory-folder="me/notes"]')!.closest("div")!;
    expect(Array.from(folder.querySelectorAll("[data-memory-row-action]")).map((node) => node.getAttribute("data-memory-row-action"))).toEqual(["new", "rename", "menu"]);
    // The list card, its toolbar and its rows.
    expect(host.querySelector("[data-memory-list-title]")?.textContent).toBe("All notes");
    expect(host.querySelector("[data-memory-list-count]")?.textContent).toBe("5 of 5");
    expect(host.querySelectorAll('[data-memory-nav-view="all"] [data-memory-note-row]').length).toBe(5);
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

  it("Preview: a click opens the console's preview beside the list, with its properties and backlinks", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-row-key="perspicax|me/n1"] [data-memory-row-open]') as HTMLButtonElement).click(); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-note]")).toBeNull();
    const panel = host.querySelector("[data-memory-preview-panel]")!;
    expect(panel).not.toBeNull();
    expect(host.querySelector("[data-memory-list]")).not.toBeNull();
    // In the content, in the list's place, left of the rail: no overlay over it.
    expect(panel.closest("[data-memory-content]")).not.toBeNull();
    expect(host.querySelector("[data-memory-preview-scrim]")).toBeNull();
    expect(host.querySelector("[data-memory-list-scroll]")!.className.split(" ")).toContain("hidden");
    expect(host.querySelector("[data-memory-sources]")).not.toBeNull();
    expect(panel.querySelector("[data-memory-note-back]")?.textContent).toBe("Memory");
    expect(panel.querySelector("[data-memory-note-line]")?.textContent).toContain("My memory / notes");
    expect(panel.querySelector("[data-memory-note-line]")?.textContent).toContain("by Dana Reyes");
    const props = panel.querySelector("[data-memory-note-props]")!.textContent!;
    for (const label of ["Tier", "Author", "Created", "Changed", "Provenance", "Source", "Versions"]) expect(props).toContain(label);
    expect(props).toContain("3 versions");
    expect(panel.querySelector("[data-memory-note-backlinks]")?.textContent).toContain("Plan");
    expect(panel.querySelector("[data-memory-note-toolbar]")?.textContent).toContain("Neighbourhood");
    // Edit in the preview opens the note's page, in edit mode.
    await act(async () => { (panel.querySelector("[data-memory-note-edit]") as HTMLButtonElement).click(); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-preview-panel]")).toBeNull();
    expect(host.querySelector("[data-memory-note]")).not.toBeNull();
    expect(host.querySelector("[data-memory-rename]")).not.toBeNull();
    expect(host.querySelector("[data-memory-tags]")).not.toBeNull();
    await act(async () => { (host.querySelector("[data-memory-note-back]") as HTMLButtonElement).click(); });
    expect(host.querySelector("[data-memory-list]")).not.toBeNull();
  });

  it("Preview: Escape and the scrim close it; a double click opens the note's page", async () => {
    await render();
    const open = host.querySelector('[data-memory-row-key="perspicax|me/n1"] [data-memory-row-open]') as HTMLButtonElement;
    await act(async () => { open.click(); });
    await wait();
    expect(host.querySelector("[data-memory-preview-panel]")).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(host.querySelector("[data-memory-preview-panel]")).toBeNull();
    await act(async () => { open.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-preview-panel]")).toBeNull();
    expect(host.querySelector("[data-memory-note]")).not.toBeNull();
  });

  it("Note page: a bot note folds its JSON block and counts its versions from the journal", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-row-key="bot:atlas|memory/dining.md"] [data-memory-row-open]') as HTMLButtonElement).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await wait();
    await settle();
    await act(async () => { (Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Cancel") as HTMLButtonElement | undefined)?.click(); });
    expect(host.querySelector("[data-memory-read-body]")).not.toBeNull();
    expect(host.querySelector("[data-memory-json-tree]")).not.toBeNull();
    expect(host.querySelector("[data-memory-note-props]")?.textContent).toContain("2 versions");
    // Travel links to [[Dining]]: a backlink.
    expect(host.querySelector("[data-memory-note-backlinks]")?.textContent).toContain("Travel");
  });

  it("Map: the Obsidian-like graph by default, the radial brain and the column map one press away, a note previews from it", async () => {
    await render();
    await act(async () => { segment("Map").click(); });
    await settle();
    expect(host.querySelector("[data-memory-sources]")).not.toBeNull();
    expect(host.querySelector('[data-memory-map-layout="graph"] [data-testid="memory-graph"] canvas')).not.toBeNull();
    const radial = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-memory-map-layout-switch] button")).find((button) => button.textContent === "Radial")!;
    await act(async () => { radial.click(); });
    expect(host.querySelector('[data-memory-map-layout="brain"] [data-testid="memory-brain"] canvas')).not.toBeNull();
    expect(host.querySelector('[data-testid="memory-brain"]')?.getAttribute("data-nodes")).toBe("5");
    expect(host.querySelector("[data-memory-map-search]")?.getAttribute("placeholder")).toBe("Find on the map");
    expect(host.querySelector('[data-memory-map-tier="mine"]')?.textContent).toContain("5");
    expect(host.querySelector("[data-memory-map-count]")?.textContent).toMatch(/^5 notes, \d+ links/);
    expect(host.querySelector("[data-memory-map-timeline]")?.textContent).toContain("Today · 5 notes");
    const columns = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-memory-map-layout-switch] button")).find((button) => button.textContent === "Columns")!;
    await act(async () => { columns.click(); });
    const note = host.querySelector('[data-memory-map-node="note"]') as HTMLButtonElement;
    await act(async () => { note.click(); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-preview-panel]")).not.toBeNull();
  });

  it("Collections: the list, one collection, its notes in order", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-nav="collections"]') as HTMLButtonElement).click(); });
    await settle();
    expect(host.querySelector("[data-memory-collection-row]")?.textContent).toContain("Onboarding book");
    await act(async () => { (host.querySelector("[data-memory-collection-row]") as HTMLButtonElement).click(); });
    await settle();
    expect(host.querySelector("[data-memory-collection-items]")?.textContent).toContain("Brief");
    expect(calls.some((call) => call.path === "/api/me/memory/collections/c1")).toBe(true);
  });

  it("Manual order: a Perspicax folder's notes follow their rank, and a drop saves the new order", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-folder="me/notes"]') as HTMLButtonElement).click(); });
    await settle();
    const manual = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-memory-list-sort] button")).find((button) => button.textContent === "Manual")!;
    await act(async () => { manual.click(); });
    expect(host.querySelector("[data-memory-reorder-hint]")).not.toBeNull();
    const rows = () => Array.from(host.querySelectorAll<HTMLElement>("[data-memory-note-row]"));
    expect(rows().map((row) => row.getAttribute("data-memory-note-row"))).toEqual(["n3", "n1"]);
    const [first, second] = rows();
    const drag = (type: string, target: HTMLElement) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      event.dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" };
      target.dispatchEvent(event);
    };
    await act(async () => { drag("dragstart", second!); });
    await act(async () => { drag("dragover", first!); drag("drop", first!); });
    await settle();
    const order = calls.find((call) => call.path === "/api/me/memory/order");
    expect(order?.method).toBe("PUT");
    expect(JSON.parse(order!.body!)).toEqual({ scope: "me", kind: "note", topic: "notes", ids: ["n1", "n3"] });
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
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).toContain("5");
    expect(host.querySelector("[data-memory-quality-area]")).not.toBeNull();
    expect(host.querySelector("[data-memory-quality-bars]")).not.toBeNull();
    const journal = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-memory-quality-tabs] button")).find((button) => button.textContent === "Journal")!;
    await act(async () => { journal.click(); });
    expect(host.querySelectorAll("[data-memory-journal-row]").length).toBe(2);
  });

  it("opens the rail from 1280px, as Automations does", async () => {
    viewport = 1280;
    await render();
    expect(host.querySelector("[data-memory-sources]")).not.toBeNull();
    expect(host.querySelector("[data-right-rail-strip]")).toBeNull();
  });

  it("folds the rail under 1280px into the strip, which opens it again", async () => {
    viewport = 1279;
    await render();
    expect(host.querySelector("[data-memory-sources]")).toBeNull();
    const strip = host.querySelector("[data-right-rail-strip]") as HTMLButtonElement;
    expect(strip).not.toBeNull();
    expect(strip.getAttribute("aria-label")).toBe("Show memory sources");
    expect(strip.className).toContain("w-10");
    expect(strip.className).toContain("border-l");
    // The strip is the body's last child, on the right of the content.
    const body = host.querySelector("[data-memory-row] .content-card-body")!;
    expect(body.children[body.children.length - 1]).toBe(strip);
    await act(async () => { strip.click(); });
    expect(host.querySelector("[data-memory-sources]")).not.toBeNull();
    await act(async () => { (host.querySelector("[data-right-rail-hide]") as HTMLButtonElement).click(); });
    expect(host.querySelector("[data-memory-sources]")).toBeNull();
    expect(host.querySelector("[data-right-rail-strip]")).not.toBeNull();
  });

  it("folds the explorer under 1280px, and Cmd+O opens it with the quick switcher", async () => {
    viewport = 1100;
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
    expect(host.querySelector('[data-memory-source="bot:northwind"]')).toBeNull();
    expect(host.textContent).not.toContain("Northwind");
    expect(Array.from(host.querySelectorAll("[data-memory-nav]")).map((node) => node.getAttribute("data-memory-nav"))).toEqual(["all", "teams", "pinned", "recent", "review", "collections", "archived", "trash", "import"]);
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
  // #3106 (the owner, 2026-11-09): "why dont I see my perspicax teams?" One tier per Perspicax team, by its real name.
  it("lists one tier per Perspicax team of the overview, with its real name and folders", async () => {
    (globalThis as { __memoryReview?: Set<string> }).__memoryReview = new Set();
    await render();
    for (const [scope, name] of [["team:7", "Équipe terrain"], ["team:9", "Back office"]]) {
      const tier = host.querySelector(`[data-memory-tier="perspicax:${scope}"]`);
      expect(tier, scope).not.toBeNull();
      expect(tier!.textContent).toContain(name);
    }
    expect(host.querySelector('[data-memory-tier="perspicax:org"]')).not.toBeNull();
    expect(host.querySelector('[data-memory-folder="team:7/dispatch"]')).not.toBeNull();
    expect(host.querySelector('[data-memory-folder="team:9/billing"]')).not.toBeNull();
  });

  // #3106 (the owner, 2026-11-09): "I should be able to approve, deny" in Review.
  it("Review: approve and deny decide a proposal, the row leaves and the count drops; no button where the viewer may not decide", async () => {
    const decided = new Set<string>();
    (globalThis as { __memoryReview?: Set<string> }).__memoryReview = decided;
    (globalThis as { __memoryWide?: boolean }).__memoryWide = true;
    await render();
    const nav = () => host.querySelector('[data-memory-nav="review"]') as HTMLButtonElement;
    await act(async () => { nav().click(); });
    await settle();
    const rowOf = (title: string) => Array.from(host.querySelectorAll<HTMLElement>("[data-memory-note-row]")).find((row) => row.textContent?.includes(title));
    const titles = () => Array.from(host.querySelectorAll<HTMLElement>("[data-memory-note-row]")).map((row) => row.querySelector("[data-memory-row-open] span span")?.textContent ?? "");
    expect(titles().sort()).toEqual(["Invoice wording", "Night shift rule", "OMB"].sort());
    expect(nav().textContent).toContain("3");
    // Not the viewer's to decide: no button and no box (hidden, never greyed).
    expect(rowOf("Invoice wording")!.querySelector("[data-memory-row-approve]")).toBeNull();
    expect(rowOf("Invoice wording")!.querySelector("[data-memory-row-deny]")).toBeNull();
    expect(rowOf("Invoice wording")!.querySelector('input[type="checkbox"]')).toBeNull();

    await act(async () => { (rowOf("Night shift rule")!.querySelector("[data-memory-row-approve]") as HTMLButtonElement).click(); });
    await settle();
    await wait();
    await settle();
    expect(calls.some((call) => call.method === "POST" && call.path === "/api/me/memory/reviews/r1/approve")).toBe(true);
    expect(rowOf("Night shift rule")).toBeUndefined();
    expect(nav().textContent).toContain("2");

    await act(async () => { (rowOf("OMB")!.querySelector("[data-memory-row-deny]") as HTMLButtonElement).click(); });
    await settle();
    await wait();
    await settle();
    expect(calls.some((call) => call.method === "DELETE" && call.path.startsWith("/api/team-memory/tm1?section="))).toBe(true);
    expect(rowOf("OMB")).toBeUndefined();
    expect(titles()).toEqual(["Invoice wording"]);
    expect(nav().textContent).toContain("1");
  });

  it("Review: the bulk bar approves the ticked proposals, and denies through Perspicax with a reason", async () => {
    const decided = new Set<string>();
    (globalThis as { __memoryReview?: Set<string> }).__memoryReview = decided;
    (globalThis as { __memoryWide?: boolean }).__memoryWide = true;
    await render();
    await act(async () => { (host.querySelector('[data-memory-nav="review"]') as HTMLButtonElement).click(); });
    await settle();
    const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('[data-memory-note-row] input[type="checkbox"]'));
    expect(boxes.length).toBe(2);
    for (const box of boxes) await act(async () => { box.click(); });
    expect(host.querySelector("[data-memory-bulk-move]")).toBeNull();
    await act(async () => { (host.querySelector("[data-memory-bulk-deny]") as HTMLButtonElement).click(); });
    await settle();
    await wait();
    await settle();
    const refuse = calls.find((call) => call.path === "/api/me/memory/reviews/r1/refuse");
    expect(refuse?.method).toBe("POST");
    expect(JSON.parse(refuse!.body!).reason).toBeTruthy();
    expect(calls.some((call) => call.method === "DELETE" && call.path.startsWith("/api/team-memory/tm1"))).toBe(true);
    expect(host.querySelectorAll("[data-memory-note-row]").length).toBe(1);
  });

  // 2026-11-03 (the owner): "I need to be able to see if it's linked to a bot" and
  // delete a folder no bot is linked to; the stray "dr eggbot 0 · No folders yet" tier.
  it("says which folders a bot is linked to, and lets an unlinked one be deleted", async () => {
    (globalThis as { __memoryLinks?: boolean }).__memoryLinks = true;
    await render();
    const row = (selector: string) => host.querySelector(selector)!.closest("[data-memory-folder-link]")!;
    // linked: the bot's mark and its name in the tooltip
    const atlas = row('[data-memory-source="bot:atlas"]');
    expect(atlas.getAttribute("data-memory-folder-link")).toBe("bot");
    expect(atlas.querySelector("[data-memory-link-mark]")).not.toBeNull();
    expect(host.querySelector('[data-memory-source="bot:atlas"]')!.getAttribute("title")).toBe("Linked to Atlas");
    // a temporary agent's memory: a plain folder, "Not linked"
    const perf = row('[data-memory-source="bot:perf"]');
    expect(perf.getAttribute("data-memory-folder-link")).toBe("none");
    expect(perf.querySelector("[data-memory-unlinked]")?.textContent).toBe("Not linked");
    expect(host.querySelector('[data-memory-source="bot:perf"]')!.getAttribute("title")).toBe("Not linked to any bot.");
    // team folders and Perspicax folders belong to no bot
    expect(row('[data-memory-folder="team:general/term"]').getAttribute("data-memory-folder-link")).toBe("none");
    expect(row('[data-memory-folder="me/notes"]').getAttribute("data-memory-folder-link")).toBe("none");
    // a section without team notes is no tier of its own
    expect(host.querySelector('[data-memory-tier="team:dr-eggbot"]')).toBeNull();
    expect(host.textContent).not.toContain("dr eggbot");
    expect(host.querySelector('[data-memory-tier="team:general"]')).not.toBeNull();

    // the linked bot's menu: who uses it, and delete greyed with the reason
    await act(async () => { (atlas.querySelector('[data-memory-row-action="menu"]') as HTMLButtonElement).click(); });
    const menu = host.querySelector("[data-memory-folder-menu]")!;
    expect(menu.querySelector("[data-memory-folder-menu-line]")?.textContent).toBe("Linked to Atlas");
    const blocked = menu.querySelector('[data-memory-folder-menu-item="delete"]') as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(blocked.textContent).toContain("Linked to Atlas; remove or archive the bot first");
    // a team folder's menu: read by its section's bots, not deletable as a folder
    const term = row('[data-memory-folder="team:general/term"]');
    await act(async () => { (term.querySelector('[data-memory-row-action="menu"]') as HTMLButtonElement).click(); });
    expect((term.querySelector('[data-memory-folder-menu] [data-memory-folder-menu-item="delete"]') as HTMLButtonElement).disabled).toBe(true);

    // the unlinked folder: Delete folder…, its notes counted, to the Trash
    await act(async () => { (perf.querySelector('[data-memory-row-action="menu"]') as HTMLButtonElement).click(); });
    const remove = perf.querySelector('[data-memory-folder-menu] [data-memory-folder-menu-item="delete"]') as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    expect(remove.textContent).toContain("Delete folder…");
    calls.length = 0;
    await act(async () => { remove.click(); });
    await settle();
    expect(confirmAsync).toHaveBeenCalledWith(expect.objectContaining({ body: "Delete the folder perf-test-061 and its 1 notes? They go to the Trash, where you can restore them." }));
    expect(calls.some((call) => call.method === "DELETE" && call.path === "/api/bots/perf/memory/file?path=memory%2Fprobe.md")).toBe(true);
  });

  it("opens the import window from the ⋯ menu and from Tidy up", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-nav="import"]') as HTMLButtonElement).click(); });
    const dialog = document.querySelector("[data-memory-import]");
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Import an Obsidian vault");
    expect(document.querySelector("[data-memory-import-folder]")?.hasAttribute("webkitdirectory")).toBe(true);
    expect(document.querySelector("[data-memory-import-zip]")?.getAttribute("accept")).toContain(".zip");
    await act(async () => { (document.querySelector("[data-memory-import] [data-dialog-close]") as HTMLButtonElement).click(); });
    expect(document.querySelector("[data-memory-import]")).toBeNull();
    expect(host.querySelector("[data-memory-import-open]")).not.toBeNull();
  });

  // the owner 2026-11-03: a note takes the content's whole place, never over the rail.
  it("a note fills the content left of the rail, its bar in its header, and Escape or Back returns to the list where it was", async () => {
    await render();
    const scroller = host.querySelector("[data-memory-list-scroll]") as HTMLDivElement;
    await act(async () => { scroller.scrollTop = 120; scroller.dispatchEvent(new Event("scroll")); });
    await act(async () => { (host.querySelector('[data-memory-source="bot:atlas"]') as HTMLButtonElement).click(); });
    await settle();
    await act(async () => { (host.querySelector('[data-memory-row-key="bot:atlas|memory/dining.md"] [data-memory-row-open]') as HTMLButtonElement).click(); });
    await wait();
    await settle();
    const content = host.querySelector("[data-memory-content]")!;
    const panel = host.querySelector("[data-memory-preview-panel]")!;
    expect(content.contains(panel)).toBe(true);
    expect(panel.className).toContain("flex-1");
    expect(panel.className).not.toMatch(/absolute|fixed/);
    // The rail stays, with the bot's folder still selected.
    const rail = host.querySelector("[data-memory-sources]")!;
    expect(rail.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(host.querySelector('[data-memory-source="bot:atlas"]')?.getAttribute("aria-current")).toBeTruthy();
    // More, Neighbourhood and Edit in the note's own bar, at its top, with "‹ Memory".
    const bar = panel.querySelector("[data-memory-note-bar]")!;
    expect(bar.querySelector("[data-memory-note-back]")?.textContent).toBe("Memory");
    expect(bar.querySelector("[data-memory-note-toolbar]")?.textContent).toContain("Neighbourhood");
    expect(panel.querySelector("[data-memory-preview]")!.firstElementChild).toBe(bar);
    // Escape: the list again.
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(host.querySelector("[data-memory-preview-panel]")).toBeNull();
    expect(host.querySelector("[data-memory-list-scroll]")!.className.split(" ")).not.toContain("hidden");
    // The note's own page fills the content the same way; Back finds the list at its scroll.
    const list = host.querySelector("[data-memory-list-scroll]") as HTMLDivElement;
    await act(async () => { list.scrollTop = 80; list.dispatchEvent(new Event("scroll")); });
    await act(async () => { (host.querySelector('[data-memory-row-key="bot:atlas|memory/dining.md"] [data-memory-row-open]') as HTMLButtonElement).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await wait();
    await settle();
    const page = host.querySelector("[data-memory-reading] [data-memory-note]")!;
    expect(page).not.toBeNull();
    expect(host.querySelector("[data-memory-content]")!.contains(page)).toBe(true);
    expect(host.querySelector("[data-memory-sources]")).not.toBeNull();
    await act(async () => { (page.querySelector("[data-memory-note-back]") as HTMLButtonElement).click(); });
    expect((host.querySelector("[data-memory-list-scroll]") as HTMLDivElement).scrollTop).toBe(80);
    expect(host.querySelector("[data-memory-list-title]")?.textContent).toBe("Atlas");
  });

  it("the note's page leaves on Escape too", async () => {
    await render();
    await act(async () => { (host.querySelector('[data-memory-row-key="perspicax|me/n1"] [data-memory-row-open]') as HTMLButtonElement).click(); });
    await wait();
    await settle();
    await act(async () => { (host.querySelector("[data-memory-preview-panel] [data-memory-note-edit]") as HTMLButtonElement).click(); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-reading] [data-memory-note]")).not.toBeNull();
    expect(host.querySelector("[data-memory-sources]")).not.toBeNull();
    // Typed into a field, Escape stays in the editor.
    const title = host.querySelector("[data-memory-rename]") as HTMLInputElement;
    await act(async () => { title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector("[data-memory-note]")).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(host.querySelector("[data-memory-note]")).toBeNull();
    expect(host.querySelector("[data-memory-list]")).not.toBeNull();
  });

  // the owner 2026-11-03: the rail on every tab, and its selection scopes each one.
  it("keeps the rail on Notes, Map, Tags and Quality", async () => {
    await render();
    for (const label of ["Notes", "Map", "Tags", "Quality"]) {
      await act(async () => { segment(label).click(); });
      await settle();
      expect(host.querySelector("[data-memory-sources]"), label).not.toBeNull();
    }
  });

  it("a folder of the rail scopes the Map, Tags and Quality, with a chip that clears it, kept across tabs and a reload", async () => {
    await render();
    await act(async () => { segment("Map").click(); });
    await settle();
    await radial();
    expect(host.querySelector('[data-testid="memory-brain"]')?.getAttribute("data-nodes")).toBe("5");
    expect(host.querySelector("[data-memory-scope-chip]")).toBeNull();
    // Atlas (a bot folder of My memory), picked on the Map tab: the tab stays.
    await act(async () => { (host.querySelector('[data-memory-source="bot:atlas"]') as HTMLButtonElement).click(); });
    await settle();
    expect(host.querySelector('[data-memory-map-layout="brain"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="memory-brain"]')?.getAttribute("data-nodes")).toBe("3");
    expect(host.querySelector("[data-memory-scope-chip]")?.textContent).toBe("Scope: Atlas");
    // Tags: only Atlas's notes (no "work", Brief's tag).
    await act(async () => { segment("Tags").click(); });
    await settle();
    expect(host.querySelector("[data-memory-scope-chip]")?.textContent).toBe("Scope: Atlas");
    expect(host.querySelector('[data-memory-tags-free-chip="work"]')).toBeNull();
    expect(host.querySelector("[data-memory-tags-orphans]")?.textContent ?? "").not.toContain("area:plan");
    // Quality: its tiles on Atlas's 3 notes, and its journal on Atlas's files.
    await act(async () => { segment("Quality").click(); });
    await settle();
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).toContain("3");
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).not.toContain("5");
    // A Perspicax folder: Personal / notes.
    await act(async () => { (host.querySelector('[data-memory-folder="me/notes"]') as HTMLButtonElement).click(); });
    await settle();
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).toContain("2");
    expect(host.querySelector("[data-memory-scope-chip]")?.textContent).toMatch(/^Scope: .+ \/ notes$/);
    // A reload keeps the tab and the scope.
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(host.querySelector('[data-memory-stat="aging"]')).not.toBeNull();
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).toContain("2");
    expect(host.querySelector("[data-memory-scope-chip]")).not.toBeNull();
    // × clears it, on the same tab.
    await act(async () => { (host.querySelector("[data-memory-scope-clear]") as HTMLButtonElement).click(); });
    await settle();
    expect(host.querySelector("[data-memory-scope-chip]")).toBeNull();
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).toContain("5");
  });
  // the owner 2026-11-06: "Memory > Atlas" in the header, the parent segment brings back the whole memory.
  it("the header crumb of a scoped memory is a link back to all the memory", async () => {
    await render();
    expect(host.querySelector("[data-memory-crumb]")).toBeNull();
    await act(async () => { (host.querySelector('[data-memory-source="bot:atlas"]') as HTMLButtonElement).click(); });
    await settle();
    expect(host.querySelector("[data-memory-section]")?.textContent).toBe("Atlas");
    const crumb = host.querySelector<HTMLButtonElement>("[data-memory-header] [data-memory-crumb]");
    expect(crumb?.textContent).toBe("Memory");
    await act(async () => { crumb!.click(); });
    await settle();
    expect(host.querySelector("[data-memory-section]")).toBeNull();
    expect(host.querySelector("[data-memory-crumb]")).toBeNull();
    expect(host.querySelector("[data-memory-scope-chip]")).toBeNull();
  });
  // 2026-11-03 (audit N-6): one request per collection at once, asked again
  // on every select while they loaded.
  it("loads the collections' notes four at a time, each collection once, even when one is selected meanwhile", async () => {
    const many = { inflight: 0, max: 0 };
    (globalThis as { __memoryMany?: typeof many }).__memoryMany = many;
    try {
      await render();
      await act(async () => { (host.querySelector('[data-memory-nav="collections"]') as HTMLButtonElement).click(); });
      await wait();
      const row = host.querySelector("[data-memory-collection-row]") as HTMLButtonElement | null;
      if (row) await act(async () => { row.click(); });
      for (let n = 0; n < 8; n += 1) await wait();
      const asked = (id: string) => calls.filter((call) => call.path === `/api/me/memory/collections/${id}` && call.method === "GET").length;
      for (let n = 2; n <= 10; n += 1) expect(asked(`c${n}`), `c${n}`).toBe(1);
      expect(many.max).toBeLessThanOrEqual(5);
    } finally {
      delete (globalThis as { __memoryMany?: unknown }).__memoryMany;
    }
  });

  // Follow-up 2026-11-03: Collections scopes the views to its notes, not to nothing.
  it("the Collections scope narrows Map, Tags and Quality to the collections' notes, loaded once and kept", async () => {
    await render();
    await act(async () => { segment("Map").click(); });
    await settle();
    await radial();
    await act(async () => { (host.querySelector('[data-memory-nav="collections"]') as HTMLButtonElement).click(); });
    await wait();
    await settle();
    // c1 holds Brief (me/n1): the union of the collections is that one note.
    expect(host.querySelector('[data-testid="memory-brain"]')?.getAttribute("data-nodes")).toBe("1");
    expect(host.querySelector("[data-memory-scope-chip]")?.textContent).toBe("Scope: Collections");
    await act(async () => { segment("Tags").click(); });
    await settle();
    expect(host.querySelector("[data-memory-tags-top]")?.textContent).toContain("work");
    await act(async () => { segment("Quality").click(); });
    await settle();
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).toContain("1");
    expect(host.querySelector('[data-memory-stat="active"]')?.textContent).not.toContain("5");
    const detailCalls = () => calls.filter((call) => call.path === "/api/me/memory/collections/c1" && call.method === "GET").length;
    expect(detailCalls()).toBe(1);
    // One collection opened on Notes: the scope is that collection, kept across tabs.
    await act(async () => { segment("Notes").click(); });
    await settle();
    await act(async () => { (host.querySelector("[data-memory-collection-row]") as HTMLButtonElement).click(); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-scope-chip]")?.textContent).toBe("Scope: Collections / Onboarding book");
    await act(async () => { segment("Map").click(); });
    await settle();
    await radial();
    expect(host.querySelector('[data-testid="memory-brain"]')?.getAttribute("data-nodes")).toBe("1");
    expect(host.querySelector("[data-memory-scope-chip]")?.textContent).toBe("Scope: Collections / Onboarding book");
    // Back on Notes, the collection is open again.
    await act(async () => { segment("Notes").click(); });
    await wait();
    await settle();
    expect(host.querySelector("[data-memory-collection-items]")).not.toBeNull();
  });
});
