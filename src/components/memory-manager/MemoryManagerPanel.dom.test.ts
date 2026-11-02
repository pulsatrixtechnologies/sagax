// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
  useCaptionChrome: () => ({ padClass: "" }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));

vi.mock("@/state/store", async () => {
  const actual = await vi.importActual<typeof import("@/state/store")>("@/state/store");
  return {
    ...actual,
    useStore: () => ({
      state: actual.initialState,
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
        return { botId: "atlas", workspacePath: "/tmp", index: { lines: 0, bytes: 0, maxLines: 200, maxBytes: 24000, loadedLines: 0, loadedBytes: 0, truncated: false, hash: "h" }, topics: [{ path: "memory/dining.md", name: "dining.md", bytes: 12, modifiedAt: 1 }], logs: [] };
      }
      if (path.includes("/memory/file")) {
        return { path: "memory/dining.md", text: "# Dining\n\n```json\n{\"likes\":\"pasta\"}\n```\n", hash: "abc", exists: true };
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

describe("MemoryManagerPanel", () => {
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

  it("lists sources then opens a bot browse and a note page", async () => {
    await act(async () => {
      root.render(createElement(MemoryManagerPanel));
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("[data-memory-manager-panel]")).not.toBeNull();
    expect(host.querySelector('[data-memory-source="bot:atlas"]')).not.toBeNull();
    expect(host.querySelector('[data-memory-source="perspicax"]')).not.toBeNull();

    await act(async () => {
      (host.querySelector('[data-memory-source="bot:atlas"]') as HTMLButtonElement).click();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-memory-browse]")).not.toBeNull();
    expect(host.querySelector("[data-memory-search]")).not.toBeNull();

    const row = host.querySelector('[data-memory-note-row="memory/dining.md"] button');
    expect(row).not.toBeNull();
    await act(async () => { (row as HTMLButtonElement).click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-memory-note]")).not.toBeNull();
    expect(host.querySelector("[data-memory-json-tree]")).not.toBeNull();
  });

  it("opens Perspicax browse, note edit fields, and the move page", async () => {
    await act(async () => {
      root.render(createElement(MemoryManagerPanel));
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      (host.querySelector('[data-memory-source="perspicax"]') as HTMLButtonElement).click();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-memory-browse]")).not.toBeNull();

    const row = host.querySelector('[data-memory-note-row="n1"] button');
    expect(row).not.toBeNull();
    await act(async () => { (row as HTMLButtonElement).click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-memory-note]")).not.toBeNull();

    await act(async () => {
      const edit = [...host.querySelectorAll("button")].find((button) => /Edit|Modifier/i.test(button.textContent || ""));
      edit?.click();
    });
    expect(host.querySelector("[data-memory-rename]")).not.toBeNull();
    expect(host.querySelector("[data-memory-tags]")).not.toBeNull();

    await act(async () => {
      const cancel = [...host.querySelectorAll("button")].find((button) => /Cancel|Annuler/i.test(button.textContent || ""));
      cancel?.click();
    });
    await act(async () => {
      const move = [...host.querySelectorAll("button")].find((button) => /Move|Déplacer/i.test(button.textContent || ""));
      move?.click();
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("[data-memory-move]")).not.toBeNull();
    expect(host.querySelector("[data-memory-move-folder]")).not.toBeNull();
    expect(host.querySelector("[data-memory-move-tier]")).not.toBeNull();
  });
});
