// @vitest-environment happy-dom
// Connect apps, simplified (2026-10-14): a plugin's Update, Test, Edit and
// Uninstall sit in one "..." menu. Since 2026-10-16 the main view filters
// with Browse Bots' pills (All, then each category), and View all, Manage, a
// detail and Browse Bots open in the same window under a breadcrumb, with
// Escape and Cmd+[ to go back.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { buildPluginItems, CATEGORY_ORDER } from "@/lib/plugins-model";
import { PluginDetailView } from "./PluginDetailView";
import { ConnectAppsView, categoryPills, moreCategoryPills } from "./ConnectAppsView";
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
    click(host.querySelector("[data-plugin-actions]"));
    const actions = [...host.querySelectorAll("[data-plugin-action]")].map((node) => node.getAttribute("data-plugin-action"));
    expect(actions).toEqual(["update", "test", "edit", "uninstall"]);
    click(host.querySelector('[data-plugin-action="uninstall"]'));
    expect(onUninstall).toHaveBeenCalledTimes(1);
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
    flushSync(() => root.render(createElement(ConnectAppsView, {
      items: rows, loading: false, search: "", onSearch: noop, filter: "all", onFilter,
      onOpenManage: noop, onOpenItem: noop, renderAction: () => null,
    })));
    const pills = [...host.querySelectorAll("[data-plugins-chip]")].map((node) => node.getAttribute("data-plugins-chip"));
    expect(pills[0]).toBe("all");
    expect(pills).toEqual(categoryPills(rows, "all"));
    expect(pills).toContain("productivity");
    expect(pills).toContain("design");
    expect(pills).not.toContain("finance");
    expect(pills.filter((pill) => pill !== "all").every((pill) => (CATEGORY_ORDER as readonly string[]).includes(pill!))).toBe(true);
    click(host.querySelector('[data-plugins-chip="design"]'));
    expect(onFilter).toHaveBeenCalledWith("design");
  });

  it("keeps a chosen More category out of the row and marks More pressed", () => {
    flushSync(() => root.render(createElement(ConnectAppsView, {
      items, loading: false, search: "", onSearch: noop, filter: "finance", onFilter: noop,
      onOpenManage: noop, onOpenItem: noop, renderAction: () => null,
    })));
    expect(host.querySelector('[data-plugins-chip="finance"]')).toBeNull();
    expect(host.querySelector("[data-plugins-more]")?.getAttribute("aria-pressed")).toBe("true");
    expect(moreCategoryPills(items, "finance")).toContain("finance");
    click(host.querySelector("[data-plugins-more]"));
    expect(host.querySelector('[data-plugins-chip="finance"]')?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("View all and the breadcrumb", () => {
  it("View all hands the section to the panel, which opens it as a page", () => {
    const onViewAll = vi.fn();
    const onFilter = vi.fn();
    const many = buildPluginItems({
      featured: Array.from({ length: 12 }, (_, index) => ({
        id: `app${index}`, name: `App ${index}`, description: "", url: `https://mcp${index}.example.net/mcp`, domain: `app${index}.example.net`, auth: "oauth", category: "productivity",
      })),
    });
    flushSync(() => root.render(createElement(ConnectAppsView, {
      items: many, loading: false, search: "", onSearch: noop, filter: "all", onFilter,
      onOpenManage: noop, onOpenItem: noop, renderAction: () => null, onViewAll,
    })));
    const viewAll = host.querySelector("[data-plugins-view-all]");
    expect(viewAll).not.toBeNull();
    click(viewAll);
    expect(onViewAll).toHaveBeenCalledTimes(1);
    expect(onViewAll.mock.calls[0]![0].filter).toEqual({ filter: "productivity" });
    expect(onFilter).not.toHaveBeenCalled();
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
