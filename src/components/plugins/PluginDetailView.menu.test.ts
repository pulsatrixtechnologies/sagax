// @vitest-environment happy-dom
// Connect apps, simplified (2026-10-14): a plugin's Test, Edit and Uninstall
// sit by the name (Uninstall as its own pill; Test/Edit in "..."). Update
// waits in the Details card. Discover filters with category pills and View
// all filters it in place; a detail and Browse Bots open in the same window
// under a breadcrumb, with Escape and Cmd+[ to go back.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { buildPluginItems, CATEGORY_ORDER } from "@/lib/plugins-model";
import { PluginDetailView } from "./PluginDetailView";
import { categoryPills, DiscoverFilter, filterChips, filterLabel, moreCategoryPills } from "./ConnectAppsView";
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

describe("plugin detail menu: the uninstall of the person's or a bot's own install", () => {
  it("says what it removes and from where, in the one \"...\" menu", () => {
    const onUninstall = vi.fn();
    flushSync(() => root.render(createElement(PluginDetailView, {
      item: items[0]!, subtitle: "", busy: false, onBack: noop, onUninstall, uninstallLabel: "Remove for me", details: [],
    })));
    click(document.querySelector("[data-entry-menu]"));
    const remove = document.querySelector('[role="menu"] [data-entry-action="remove"]');
    expect(remove?.textContent).toContain("Remove for me");
    click(remove);
    expect(onUninstall).toHaveBeenCalledTimes(1);
  });
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
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // Update is the header's main action (the Customize page's shape), it is not said twice (no dot on "...", nothing in Details)
    expect(document.querySelector('[data-plugin-action="update"]')?.textContent).toBe("Update");
    expect(document.querySelector("[data-plugin-update-row]")).toBeNull();
    // the dot would repeat the Update button beside it: none
    expect(document.querySelector("[data-plugin-update-dot]")).toBeNull();
    click(document.querySelector('[data-plugin-action="update"]'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    // Uninstall is in the one "..." menu (the same menu as a row's, never a second pill)
    expect(document.querySelector('[data-plugin-action="uninstall"]')).toBeNull();
    click(document.querySelector("[data-entry-menu]"));
    const actions = [...document.querySelectorAll('[role="menu"] [data-entry-action]')].map((node) => node.getAttribute("data-entry-action"));
    expect(actions).toEqual(["test", "edit", "remove"]);
    click(document.querySelector('[data-entry-action="test"]'));
    expect(onTest).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    click(document.querySelector("[data-entry-menu]"));
    click(document.querySelector('[role="menu"] [data-entry-action="remove"]'));
    expect(onUninstall).toHaveBeenCalledTimes(1);
  });

  it("has no menu when the plugin offers no action", () => {
    flushSync(() => root.render(createElement(PluginDetailView, {
      item: items[0]!, subtitle: "", busy: false, onBack: noop, details: [],
    })));
    expect(document.querySelector("[data-entry-menu]")).toBeNull();
  });
});

describe("The filter button (#4453: the categories left the row of pills)", () => {
  const rows = buildPluginItems({
    featured: [
      { id: "notion", name: "Notion", description: "Pages", url: "https://mcp.notion.com/mcp", domain: "notion.so", auth: "oauth", category: "productivity" },
      { id: "figma", name: "Figma", description: "Files", url: "https://mcp.figma.com/mcp", domain: "figma.com", auth: "oauth", category: "design" },
    ],
  });

  it("Discover draws no row of category pills", () => {
    flushSync(() => root.render(createElement(DiscoverView, discover({ items: rows }))));
    expect(document.querySelector("[data-plugins-chip]")).toBeNull();
    expect(document.querySelector("[data-plugins-chips]")).toBeNull();
  });

  it("All, then each category that has a row, in the button's menu; a click filters on it", () => {
    const onPick = vi.fn();
    flushSync(() => root.render(createElement(DiscoverFilter, { chips: filterChips(rows, "all"), filter: "all", onPick, label: (chip) => filterLabel(chip) })));
    const button = document.querySelector<HTMLElement>("[data-plugins-filter-button]")!;
    // icon only: its name is the aria-label
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Filter");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    click(button);
    const pills = [...document.querySelectorAll("[data-plugins-chip]")].map((node) => node.getAttribute("data-plugins-chip"));
    expect(pills[0]).toBe("all");
    expect(pills).toEqual([...categoryPills(rows, "all"), ...moreCategoryPills(rows, "all")]);
    expect(pills).toContain("productivity");
    expect(pills).toContain("design");
    expect(pills).not.toContain("finance");
    expect(pills.filter((pill) => pill !== "all").every((pill) => (CATEGORY_ORDER as readonly string[]).includes(pill!))).toBe(true);
    click(document.querySelector('[data-plugins-chip="design"]'));
    expect(onPick).toHaveBeenCalledWith("design");
    // the menu closes on a pick
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("a chosen category is named on the button and checked in its menu", () => {
    flushSync(() => root.render(createElement(DiscoverFilter, { chips: filterChips(rows, "design"), filter: "design", onPick: noop, label: (chip) => filterLabel(chip) })));
    const button = document.querySelector<HTMLElement>("[data-plugins-filter-button]")!;
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toContain(filterLabel("design"));
    click(button);
    expect(document.querySelector('[data-plugins-chip="design"]')?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[data-plugins-chip="all"]')?.getAttribute("aria-checked")).toBe("false");
  });

  it("no button when there is nothing to filter (only All)", () => {
    flushSync(() => root.render(createElement(DiscoverFilter, { chips: ["all"], filter: "all", onPick: noop, label: (chip) => filterLabel(chip) })));
    expect(document.querySelector("[data-plugins-filter]")).toBeNull();
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
    const viewAll = document.querySelector("[data-plugins-view-all=\"productivity\"]");
    expect(viewAll).not.toBeNull();
    click(viewAll);
    expect(onFilter).toHaveBeenCalledWith("productivity");
    expect(document.querySelector("[data-breadcrumb]")).toBeNull();
  });

  it("Recommended has its View all on the right, like the reference app's, and View all lists every pick (#4207)", () => {
    const onType = vi.fn();
    // eight curated picks: the shelf shows six, as the reference does
    const many = buildPluginItems({
      featured: ["Notion", "Linear", "Slack", "Figma", "Asana", "Atlassian", "Stripe", "Canva"].map((name) => ({
        id: name.toLowerCase(), name, description: "", url: `https://mcp.${name.toLowerCase()}.example.net/mcp`, domain: `${name.toLowerCase()}.example.net`, auth: "oauth", category: "productivity",
      })),
    });
    const action = (item: { action: string | null }) => (item.action ? createElement("button", { type: "button" }, "Connect") : null);
    flushSync(() => root.render(createElement(DiscoverView, discover({ items: many, onType, renderAction: action }))));
    // the shelf previews six picks: the first three are the slides of the featured block, the other three its cards
    expect(document.querySelector("[data-featured-banner]")).not.toBeNull();
    expect(document.querySelectorAll("[data-featured-dot]")).toHaveLength(3);
    expect(document.querySelectorAll('[data-plugins-section="recommended"] [data-plugin-row]')).toHaveLength(3);
    expect(document.querySelector('[data-plugins-section="recommended"] [data-section-count]')?.getAttribute("data-section-count")).toBe("5");
    const viewAll = document.querySelector("[data-plugins-view-all=\"recommended\"]");
    expect(viewAll).not.toBeNull();
    click(viewAll);
    expect(onType).toHaveBeenCalledWith("recommended");
    flushSync(() => root.render(createElement(DiscoverView, discover({ items: many, type: "recommended", renderAction: action }))));
    expect(document.querySelectorAll('[data-plugins-section="recommended"] [data-plugin-row]')).toHaveLength(8);
    expect(document.querySelector("[data-featured-banner]")).toBeNull();
    // the type pill names it
    expect(document.querySelector('[data-plugins-type="recommended"]')?.textContent).toContain("Recommended for you");
  });

  it("the back button and a crumb go back; the current page is not a link", () => {
    const onBack = vi.fn();
    const toRoot = vi.fn();
    flushSync(() => root.render(createElement(Breadcrumb, {
      trail: [{ label: "Connect apps", onSelect: toRoot }, { label: "Productivity", onSelect: noop }],
      current: "Notion",
      onBack,
    })));
    click(document.querySelector("[data-breadcrumb-back]"));
    expect(onBack).toHaveBeenCalledTimes(1);
    click(document.querySelector('[data-breadcrumb-crumb="0"]'));
    expect(toRoot).toHaveBeenCalledTimes(1);
    const current = document.querySelector("[data-breadcrumb-current]");
    expect(current?.getAttribute("aria-current")).toBe("page");
    expect(current?.textContent).toBe("Notion");
    expect(current?.querySelector("button")).toBeNull();
    expect(document.querySelector("nav")?.getAttribute("aria-label")).toBe("Breadcrumb");
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
