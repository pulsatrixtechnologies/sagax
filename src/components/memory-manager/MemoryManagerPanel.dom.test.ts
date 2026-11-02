// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
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
    const row = host.querySelector('[data-memory-note-row]') as HTMLElement;
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
