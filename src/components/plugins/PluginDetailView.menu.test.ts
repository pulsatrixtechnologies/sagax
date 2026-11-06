// @vitest-environment happy-dom
// Connect apps, simplified (2026-10-14): a plugin's Update, Test, Edit and
// Uninstall sit in one "..." menu. Discover (the view Connect apps opens on
// since 2026-10-27) filters with Browse Bots' pills (All, then each
// category, every one on the row) and View all filters it in place; a
// detail and Browse Bots open in the same window under a breadcrumb, with
// Escape and Cmd+[ to go back.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { buildPluginItems, CATEGORY_ORDER } from "@/lib/plugins-model";
import { PluginDetailView } from "./PluginDetailView";
import { categoryPills, filterLabel, moreCategoryPills } from "./ConnectAppsView";
import { DiscoverView, type DiscoverViewProps } from "./DiscoverView";
import { Breadcrumb } from "../Breadcrumb";
import { isBackShortcut, pageKeyAction } from "@/lib/back-shortcut";

vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const items = buildPluginItems({ servers: [{ name: "glitcho", enabled: true, url: "https://qc1.example.net/mcp", auth: "connected" }] });
const noop = () => {};
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const click = (element: Element | null) => flushSync(() => (element as HTMLElement).click());
const discover = (overrides: Partial<DiscoverViewProps>): DiscoverViewProps => ({
  items, filter: "all", onFilter: noop, type: "any", onType: noop,
  sourceLabel: (source) => source, onOpenItem: noop, renderAction: () => null, ...overrides,
});

describe("plugin detail menu", () => {
  it("opens on the \"...\" button and runs the chosen action", () => {
    const onUpdate = vi.fn();
    const onUninstall = vi.fn();
    const onTest = vi.fn();
    flushSync(() => root.render(createElement(PluginDetailView, {
      item: items[0]!, subtitle: "https://qc1.example.net/mcp", busy: false, onBack: noop,
      onUpdate, onTest, onEdit: noop, onUninstall, details: [],
    })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    // an update waiting shows as a dot on the button
    expect(host.querySelector("[data-plugin-update-dot]")).not.toBeNull();
    // Uninstall is the header's own pill, as in Grok Bot's Connect Apps
    expect(host.querySelector('[role="menu"] [data-plugin-action="uninstall"]')).toBeNull();
    click(host.querySelector('[data-plugin-action="uninstall"]'));
    expect(onUninstall).toHaveBeenCalledTimes(1);
    click(host.querySelector("[data-plugin-actions]"));
    const actions = [...host.querySelectorAll('[role="menu"] [data-plugin-action]')].map((node) => node.getAttribute("data-plugin-action"));
    expect(actions).toEqual(["update", "test", "edit"]);
    click(host.querySelector('[data-plugin-action="test"]'));
    expect(onTest).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("has no menu when the plugin offers no action", () => {
    flushSync(() => root.render(createElement(PluginDetailView, {
      item: items[0]!, subtitle: "", busy: false, onBack: noop, details: [],
    })));
    expect(host.querySelector("[data-plugin-actions]")).toBeNull();
  });
});

describe("Category pills", () => {
  it("All, then each category that has a row, and a click filters on it", () => {
    const onFilter = vi.fn();
    const rows = buildPluginItems({
      featured: [
        { id: "notion", name: "Notion", description: "Pages", url: "https://mcp.notion.com/mcp", domain: "notion.so", auth: "oauth", category: "productivity" },
        { id: "figma", name: "Figma", description: "Files", url: "https://mcp.figma.com/mcp", domain: "figma.com", auth: "oauth", category: "design" },
      ],
    });
    flushSync(() => root.render(createElement(DiscoverView, discover({ items: rows, onFilter }))));
    const pills = [...host.querySelectorAll("[data-plugins-chip]")].map((node) => node.getAttribute("data-plugins-chip"));
    expect(pills[0]).toBe("all");
    expect(pills).toEqual([...categoryPills(rows, "all"), ...moreCategoryPills(rows, "all")]);
    expect(pills).toContain("productivity");
    expect(pills).toContain("design");
    expect(pills).not.toContain("finance");
    expect(pills.filter((pill) => pill !== "all").every((pill) => (CATEGORY_ORDER as readonly string[]).includes(pill!))).toBe(true);
    click(host.querySelector('[data-plugins-chip="design"]'));
    expect(onFilter).toHaveBeenCalledWith("design");
  });

  it("a chosen category stays on the row: pressed on the row, or named and white on More (#2104)", () => {
    flushSync(() => root.render(createElement(DiscoverView, discover({ filter: "finance" }))));
    expect(host.querySelector("[data-plugins-more]")).toBeNull();
    const chip = host.querySelector<HTMLElement>('[data-plugins-chip="finance"]')!;
    expect(chip).not.toBeNull();
    if (chip.getAttribute("aria-haspopup") === "menu") {
      expect(chip.textContent).toContain(filterLabel("finance"));
      expect(chip.className).toContain("bg-ink");
    } else {
      expect(chip.getAttribute("aria-pressed")).toBe("true");
    }
  });
});

describe("View all and the breadcrumb", () => {
  it("View all filters Discover in place: no page of its own", () => {
    const onFilter = vi.fn();
    const many = buildPluginItems({
      featured: Array.from({ length: 12 }, (_, index) => ({
        id: `app${index}`, name: `App ${index}`, description: "", url: `https://mcp${index}.example.net/mcp`, domain: `app${index}.example.net`, auth: "oauth", category: "productivity",
      })),
    });
    flushSync(() => root.render(createElement(DiscoverView, discover({ items: many, onFilter }))));
    const viewAll = host.querySelector("[data-plugins-view-all=\"productivity\"]");
    expect(viewAll).not.toBeNull();
    click(viewAll);
    expect(onFilter).toHaveBeenCalledWith("productivity");
    expect(host.querySelector("[data-breadcrumb]")).toBeNull();
  });

  it("Recommended has its View all on the right, like Grok Bot's", () => {
    const onType = vi.fn();
    const many = buildPluginItems({
      featured: Array.from({ length: 8 }, (_, index) => ({
        id: `app${index}`, name: `App ${index}`, description: "", url: `https://mcp${index}.example.net/mcp`, domain: `app${index}.example.net`, auth: "oauth", category: "productivity",
      })),
    });
    flushSync(() => root.render(createElement(DiscoverView, discover({ items: many, onType }))));
    const viewAll = host.querySelector("[data-plugins-view-all=\"recommended\"]");
    expect(viewAll).not.toBeNull();
    click(viewAll);
    expect(onType).toHaveBeenCalledWith("recommended");
  });

  it("the back button and a crumb go back; the current page is not a link", () => {
    const onBack = vi.fn();
    const toRoot = vi.fn();
    flushSync(() => root.render(createElement(Breadcrumb, {
      trail: [{ label: "Connect apps", onSelect: toRoot }, { label: "Productivity", onSelect: noop }],
      current: "Notion",
      onBack,
    })));
    click(host.querySelector("[data-breadcrumb-back]"));
    expect(onBack).toHaveBeenCalledTimes(1);
    click(host.querySelector('[data-breadcrumb-crumb="0"]'));
    expect(toRoot).toHaveBeenCalledTimes(1);
    const current = host.querySelector("[data-breadcrumb-current]");
    expect(current?.getAttribute("aria-current")).toBe("page");
    expect(current?.textContent).toBe("Notion");
    expect(current?.querySelector("button")).toBeNull();
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe("Breadcrumb");
  });
});

describe("Escape and Cmd+[ in a window with pages", () => {
  const key = (init: Partial<KeyboardEvent>) => ({ key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init });
  const escape = key({ key: "Escape" });
  const cmdBracket = key({ key: "[", code: "BracketLeft", metaKey: true });

  it("Escape goes back one page, and closes on the first", () => {
    expect(pageKeyAction(escape, { depth: 2 }, true)).toBe("back");
    expect(pageKeyAction(escape, { depth: 0 }, true)).toBe("close");
  });

  it("Cmd+[ goes back and never closes", () => {
    expect(pageKeyAction(cmdBracket, { depth: 1 }, true)).toBe("back");
    expect(pageKeyAction(cmdBracket, { depth: 0 }, true)).toBeNull();
    // Ctrl+[ off a Mac; Cmd+Shift+[ stays the previous bot
    expect(pageKeyAction(key({ key: "[", ctrlKey: true }), { depth: 1 }, false)).toBe("back");
    expect(pageKeyAction(key({ key: "[", metaKey: true, shiftKey: true }), { depth: 1 }, true)).toBeNull();
    expect(pageKeyAction(key({ key: "a", metaKey: true }), { depth: 1 }, true)).toBeNull();
  });

  it("Browse Bots' own step (a detail, View all) comes first", () => {
    const innerBack = vi.fn(() => true);
    expect(pageKeyAction(escape, { depth: 1, innerBack }, true)).toBe("inner");
    expect(innerBack).toHaveBeenCalledTimes(1);
    expect(pageKeyAction(escape, { depth: 1, innerBack: () => false }, true)).toBe("back");
    expect(pageKeyAction(cmdBracket, { depth: 1, innerBack: () => false }, true)).toBe("back");
  });

  it("the back button says both keys", () => {
    expect(isBackShortcut(cmdBracket, true)).toBe(true);
    expect(isBackShortcut(escape, true)).toBe(false);
  });
});
