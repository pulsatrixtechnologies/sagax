// @vitest-environment happy-dom
// Plugins (Capabilities before #2104), regressions kept through the the reference app
// Connect Apps redesign (2026-11-06):
//   - #4453 (2026-11-16): no scope control in the window's header (the
//     scope is chosen on each item); the ScopeToggle itself stays for
//     Tailscale's modes;
//   - #4453: the kind tabs (Skills, Connectors, Plugins) and the view
//     (Yours, Discover); "..." opens Bots, Pages and Sources; the close
//     button keeps clear of the title row;
//   - a plugin's page takes the whole pane under its own back bar, with the
//     app's real mark, its name once, the technical id as metadata, where it
//     is installed and its main action; the view it came from is on the
//     back button's label.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { buildPluginItems } from "@/lib/plugins-model";
import { detailIdentity, installedEntries } from "@/lib/installed-model";
import { CATEGORY_MODAL } from "../category-modal";
import { CONNECT_APPS_TABS, ConnectAppsView, type ConnectAppsTab } from "./ConnectAppsView";
import { PluginDetailView } from "./PluginDetailView";
import { ScopeToggle } from "./ScopeToggle";

vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const items = buildPluginItems({
  servers: [{ name: "github-github", enabled: true, url: "https://api.githubcopilot.com/mcp/", source: "claude-plugins-official" }],
  marketplaces: [{ name: "claude-plugins-official", plugins: [{ name: "github", installed: true, servers: ["github-github"], skills: [] }] }],
});
const noop = () => {};
const TABS: ConnectAppsTab[] = ["installed", "discover", "sources"];

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

const view = (tab: ConnectAppsTab, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ConnectAppsView, {
  tab, onTab: noop, refreshing: false, onRefresh: noop,
  installed: "I", discover: "D", pages: "G", sources: "S", ...extra,
}));

describe("no scope bar in the window (#4453, 2026-11-16: the scope is chosen on the item)", () => {
  it("draws no scope control under the title on any view", () => {
    for (const tab of [...TABS, "pages" as const]) {
      const html = view(tab);
      expect(html, tab).not.toContain("data-plugins-scope-slot");
      expect(html, tab).not.toContain("data-plugins-scope-option");
    }
  });

  it("on Pages the toggle is shown turned off, with the line that says why", () => {
    flushSync(() => root.render(createElement(ScopeToggle, { scope: "bot", botName: "Rocket", onScope: noop, disabled: true, describedBy: "why" })));
    const group = host.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-disabled")).toBe("true");
    expect(group.getAttribute("aria-describedby")).toBe("why");
    const options = [...host.querySelectorAll<HTMLButtonElement>("[data-plugins-scope-option]")];
    // bot + me + everyone (organization defaults on)
    expect(options).toHaveLength(3);
    expect(options.every((option) => option.disabled)).toBe(true);
    // the scope in use is still the one marked
    expect(host.querySelector('[data-plugins-scope-option="bot"]')?.getAttribute("aria-checked")).toBe("true");
  });
});

describe("the header", () => {
  it("#4453: a kind tab and Yours or Discover each say which they are and choose it", () => {
    expect(CONNECT_APPS_TABS).toEqual(["installed", "discover", "bots", "pages", "sources"]);
    const onTab = vi.fn();
    const onKind = vi.fn();
    flushSync(() => root.render(createElement(ConnectAppsView, { tab: "installed", onTab, kind: "skills", onKind, refreshing: false, onRefresh: noop })));
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]')];
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected")])).toEqual([["Skills", "true"], ["Connectors", "false"], ["Plugins", "false"]]);
    flushSync(() => tabs[2]!.click());
    expect(onKind).toHaveBeenCalledWith("plugins");
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-plugins-view="discover"]')!.click());
    expect(onTab).toHaveBeenCalledWith("discover");
    // "...": Bot templates, Published pages, Sources, each opening its view
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-plugins-more-button]")!.click());
    const links = [...host.querySelectorAll<HTMLButtonElement>("[data-plugins-view-link]")];
    expect(links.map((link) => link.textContent)).toEqual(["Bot templates", "Published pages", "Sources"]);
    flushSync(() => links[1]!.click());
    expect(onTab).toHaveBeenCalledWith("pages");
  });

  it("Yours: no refresh button in the head (it is the \"...\" menu's first line), no scope slot; Pages' back row returns to the view it came from", () => {
    const onTab = vi.fn();
    const html = view("installed");
    expect(html).not.toContain("data-plugins-scope-slot");
    expect(html).not.toMatch(/aria-label="Refresh[^"]*"/);
    flushSync(() => root.render(createElement(ConnectAppsView, { tab: "pages", onTab, home: "discover", refreshing: false, onRefresh: noop })));
    flushSync(() => host.querySelector<HTMLButtonElement>("[data-plugins-home]")!.click());
    expect(onTab).toHaveBeenCalledWith("discover");
  });

  it("the title row keeps clear of the close button at every width", () => {
    expect(CATEGORY_MODAL.titleBar).toContain("pr-12");
    expect(CATEGORY_MODAL.titleBar).not.toMatch(/\bsm:px-/);
  });
});

describe("a plugin's page in its tab", () => {
  it("takes the whole pane: the view's list and scope are not drawn under it, the title stays for screen readers", () => {
    const html = view("installed", { page: createElement("div", { "data-test-page": "" }, "PAGE") });
    expect(html).toMatch(/data-plugins-main="installed"[^>]*data-plugins-subpage=""[\s\S]*?data-test-page/);
    // the window keeps its accessible name, hidden from view
    expect(html).toMatch(/<h2 id="plugins-title" class="sr-only">Connect Apps<\/h2>/);
    expect(html).not.toMatch(/>I</);
  });

  it("names the plugin for people with its real mark; the id is metadata", () => {
    const entries = installedEntries(items);
    const plugin = items.find((item) => item.kind === "plugin")!;
    const identity = detailIdentity(plugin, entries);
    expect(identity.name).toBe("GitHub");
    expect(identity.icon.kind).toBe("app");
    expect(identity.icon.logo || identity.icon.domain).toBeTruthy();
  });

  it("shows the name once, where it is installed and the main action; the back button names the view", () => {
    const entries = installedEntries(items);
    const plugin = items.find((item) => item.kind === "plugin")!;
    const identity = detailIdentity(plugin, entries);
    const onBack = vi.fn();
    flushSync(() => root.render(createElement(PluginDetailView, {
      item: plugin, displayName: identity.name, icon: identity.icon, subtitle: "example/marketplace", busy: false,
      onBack, trail: [{ label: "Installed", onSelect: onBack }], details: [],
      installState: [{ id: "everyone", label: "Installed for everyone", on: true }, { id: "bot", label: "Not installed on Rocket", on: false }],
      primaryAction: createElement("button", { type: "button", "data-test-primary": "" }, "Install for Rocket"),
    })));
    // one visible name, no second title in the back row
    const visibleNames = [...host.querySelectorAll("h2, [data-breadcrumb-current]")].filter((node) => node.textContent === "GitHub");
    expect(visibleNames).toHaveLength(1);
    expect(host.querySelector("[data-breadcrumb-current]")).toBeNull();
    expect(host.querySelector("[data-plugins-back]")?.getAttribute("aria-label")).toBe("Back to Installed");
    // the real mark, not the generic plugin piece
    expect(host.querySelector("[data-plugins-detail-head] img")).not.toBeNull();
    // the technical name and source as small metadata
    expect(host.querySelector("[data-plugins-detail-meta]")?.textContent).toBe("github · example/marketplace");
    const states = [...host.querySelectorAll("[data-install-state]")].map((node) => [node.getAttribute("data-install-state"), node.getAttribute("data-install-on")]);
    expect(states).toEqual([["everyone", "yes"], ["bot", "no"]]);
    expect(host.querySelector("[data-plugins-detail-head] [data-test-primary]")).not.toBeNull();
    flushSync(() => host.querySelector<HTMLElement>("[data-plugins-back]")!.click());
    expect(onBack).toHaveBeenCalled();
  });
});
