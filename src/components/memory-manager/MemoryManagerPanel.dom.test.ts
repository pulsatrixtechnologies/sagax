// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { windowChrome: "default", host: { label: "Test" } } }),
  useCaptionChrome: () => ({ dragProps: {}, controlsShiftStyle: undefined, padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));

vi.mock("../ConfirmProvider", () => ({
  confirmAsync: vi.fn(async () => true),
  useConfirm: () => vi.fn(async () => true),
  discardConfirmRequest: (body?: string) => ({ title: "Discard", body }),
}));

vi.mock("@/state/store", async () => {
  const actual = await vi.importActual<typeof import("@/state/store")>("@/state/store");
  return {
    ...actual,
    useStore: () => ({
      state: { ...actual.initialState, activeView: "memory", memoryManagerOpen: true },
      dispatch: vi.fn(),
    }),
    useStoreOptional: () => null,
    api: vi.fn(async (path: string) => {
      if (path === "/api/memory-manager/sources") {
        return {
          sources: [
            { id: "bot:atlas", kind: "bot", name: "Atlas", detail: "Bot memory", mayWrite: true, botId: "atlas" },
            { id: "perspicax", kind: "perspicax", name: "Perspicax", mayWrite: true, mayManage: true, scope: "me" },
          ],
          perspicax: { available: true },
        };
      }
      if (path.startsWith("/api/bots/atlas/memory") && !path.includes("/file")) {
        return {
          botId: "atlas",
          workspacePath: "/tmp",
          index: { lines: 0, bytes: 0, maxLines: 200, maxBytes: 24000, loadedLines: 0, loadedBytes: 0, truncated: false, hash: "h" },
          topics: [
            { path: "memory/dining.md", name: "dining.md", bytes: 12, modifiedAt: 1 },
            { path: "memory/travel.md", name: "travel.md", bytes: 8, modifiedAt: 2 },
          ],
          logs: [],
        };
      }
      if (path.includes("/memory/file")) {
        return { path: "memory/dining.md", text: "# Dining\n\nSee [[Travel]].\n\n```json\n{\"likes\":\"pasta\"}\n```\n", hash: "abc", exists: true };
      }
      if (path.startsWith("/api/me/memory/tree")) {
        return {
          tiers: [{
            scope: "me", kind: "me", name: "Personal", may_write: true, may_manage: true, trashed: 0,
            topics: [{ topic: "notes", count: 1, entries: [{ id: "n1", title: "Brief", topic: "notes", tags: ["work"], excerpt: "Keep" }] }],
          }],
        };
      }
      if (path.startsWith("/api/me/memory/entry")) {
        return { id: "n1", scope: "me", topic: "notes", title: "Brief", body: "# Brief\n", tags: ["work"], may_edit: true, version: 1 };
      }
      if (path.startsWith("/api/me/memory/bulk")) {
        return { action: "move", done: 1, review: 0, refused: 0, items: [] };
      }
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

describe("MemoryManagerPanel page", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setLocale("en");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens as a main page with sources list", async () => {
    await act(async () => {
      root.render(createElement(MemoryManagerPanel));
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("[data-memory-manager-page]")).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("[data-memory-sources]")).not.toBeNull();
    expect(host.textContent).toContain("Memory");
    expect(host.textContent).toContain("Atlas");
  });

  it("lays out the left column like the Perspicax explorer, with real counts only", async () => {
    await act(async () => {
      root.render(createElement(MemoryManagerPanel));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    // The Automations header row: icon and title, no subtitle stacked in the header.
    expect(host.querySelector("[data-memory-header] h1")?.textContent).toBe("Memory");
    expect(host.querySelector("[data-memory-search]")?.getAttribute("placeholder")).toBe("Open a note");
    const navIds = Array.from(host.querySelectorAll("[data-memory-nav]")).map((node) => node.getAttribute("data-memory-nav"));
    // No team source, no proposal, no pin: only the views with data show.
    expect(navIds).toEqual(["all", "trash"]);
    expect(host.querySelector('[data-memory-nav="all"]')?.textContent).toContain("4");
    expect(host.textContent).toContain("Tiers");
    const mine = host.querySelector('[data-memory-tier="mine"]') as HTMLElement;
    expect(mine.textContent).toContain("My memory");
    expect(mine.textContent).toContain("4");
    // The bot is a folder of My memory, not a "Bot memory" card.
    expect(host.querySelector('[data-memory-source="bot:atlas"]')?.textContent).toContain("Atlas");
    expect(host.querySelector('[data-memory-source="bot:atlas"]')?.textContent).not.toContain("Bot memory");
    // A Perspicax folder offers its real actions.
    const folder = host.querySelector('[data-memory-folder="me/notes"]')!.closest("div")!;
    const actions = Array.from(folder.querySelectorAll("[data-memory-row-action]")).map((node) => node.getAttribute("data-memory-row-action"));
    expect(actions).toEqual(["new", "rename", "delete"]);
    // All notes lists every source's notes in the body column.
    expect(host.querySelectorAll('[data-memory-nav-view="all"] [data-memory-note-row]').length).toBe(4);
    // No identifier is shown.
    expect(host.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("filters the notes from the Open a note field", async () => {
    await act(async () => {
      root.render(createElement(MemoryManagerPanel));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    const input = host.querySelector("[data-memory-search]") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "brief");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = host.querySelectorAll('[data-memory-nav-view="all"] [data-memory-note-row]');
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain("Brief");
  });

  it("lists notes then opens a note from the list", async () => {
    await act(async () => {
      root.render(createElement(MemoryManagerPanel));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const source = host.querySelector('[data-memory-source="bot:atlas"]') as HTMLButtonElement;
    expect(source).not.toBeNull();
    await act(async () => { source.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-memory-browse]")).not.toBeNull();
    const row = host.querySelector('[data-memory-browse] [data-memory-note-row]') as HTMLElement;
    expect(row).not.toBeNull();
    const open = row.querySelector("button") as HTMLButtonElement;
    await act(async () => { open.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-memory-note]")).not.toBeNull();
    expect(host.querySelector("[data-memory-read-body], [data-memory-json-tree]")).not.toBeNull();
  });

  it("map view shows nodes and a note click opens the note", async () => {
    await act(async () => {
      root.render(createElement(MemoryManagerPanel));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const source = host.querySelector('[data-memory-source="bot:atlas"]') as HTMLButtonElement;
    await act(async () => { source.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    const mapToggle = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Map"));
    expect(mapToggle).toBeTruthy();
    await act(async () => { mapToggle!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("[data-memory-map]")).not.toBeNull();
    const noteNode = host.querySelector('[data-memory-map-node="note"]') as HTMLButtonElement;
    expect(noteNode).not.toBeNull();
    await act(async () => { noteNode.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-memory-note]")).not.toBeNull();
  });
});
