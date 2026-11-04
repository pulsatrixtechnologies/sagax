// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetGraphSettingsSession } from "@/lib/memory-graph-settings";
import type { MemoryManagerSource } from "@/lib/memory-manager";
import type { PageRow, PageTier } from "@/lib/memory-page";
import { MemoryMapView } from "./MemoryMapView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tiers: PageTier[] = [{ key: "bot:atlas", name: "Atlas", kind: "team", color: "var(--color-warning)" }];
const source = { id: "bot:atlas", kind: "bot", name: "Atlas", mayWrite: true } as MemoryManagerSource;
const row = (id: string, title: string, folderPath: string, tags: string[] = []): PageRow => ({
  key: `bot:atlas|${id}`, source, tier: "bot:atlas", folderKey: folderPath, folderPath, row: { id, title, tags, createdAt: Date.now() - 86_400_000 },
});
const rows = [row("1", "Dining", "Atlas / Topics", ["food"]), row("2", "Travel", "Atlas / Topics"), row("3", "Run 1", "Atlas / Logs")];
const bodies = { "bot:atlas|1": "See [[Travel]]." };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  window.localStorage.clear();
  forgetGraphSettingsSession();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (props: Partial<Parameters<typeof MemoryMapView>[0]> = {}) =>
  act(() => root.render(createElement(MemoryMapView, { rows, tiers, bodies, review: 0, onOpen: () => {}, ...props })));

describe("Memory > Map > Graph", () => {
  it("offers Graph, Radial and Columns, Graph first and chosen, and draws a canvas", () => {
    render();
    const options = [...host.querySelectorAll<HTMLButtonElement>("[data-memory-map-layout-switch] button")];
    expect(options.map((button) => button.textContent)).toEqual(["Graph", "Radial", "Columns"]);
    expect(options[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-memory-map-layout]")?.getAttribute("data-memory-map-layout")).toBe("graph");
    expect(host.querySelector('canvas[data-testid="memory-graph-canvas"]')).not.toBeNull();
    // three notes, the tier and two folders (Folders and tiers is on by default)
    expect(host.querySelector("[data-memory-graph]")?.getAttribute("data-nodes")).toBe("6");
    act(() => options[1]!.click());
    expect(host.querySelector("[data-memory-graph]")).toBeNull();
    expect(host.querySelector('[data-testid="memory-brain"]')).not.toBeNull();
  });

  it("opens the settings card and its filters change the graph", () => {
    render();
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="memory-graph-settings-open"]')!.click());
    const card = host.querySelector('[data-testid="memory-graph-settings"]')!;
    expect(card).not.toBeNull();
    expect([...card.querySelectorAll("[data-graph-section]")].map((s) => s.getAttribute("data-graph-section"))).toEqual(["filters", "groups", "display", "forces"]);
    act(() => card.querySelector<HTMLButtonElement>('[data-graph-toggle="tags"] button')!.click());
    expect(host.querySelector("[data-memory-graph]")?.getAttribute("data-nodes")).toBe("7");
    act(() => card.querySelector<HTMLButtonElement>('[data-graph-toggle="folders"] button')!.click());
    expect(host.querySelector("[data-memory-graph]")?.getAttribute("data-nodes")).toBe("4");
    // remembered: a new page reads them back
    act(() => root.unmount());
    forgetGraphSettingsSession();
    root = createRoot(host);
    render();
    expect(host.querySelector('[data-testid="memory-graph-settings"]')).not.toBeNull();
    expect(host.querySelector("[data-memory-graph]")?.getAttribute("data-nodes")).toBe("4");
  });

  it("follows the rail's scope", () => {
    render({ scope: (entry) => entry.folderPath === "Atlas / Logs" });
    expect(host.querySelector("[data-memory-map-count]")?.textContent).toContain("1 notes");
  });
});
