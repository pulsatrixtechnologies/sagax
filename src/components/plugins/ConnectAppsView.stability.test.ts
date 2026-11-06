// @vitest-environment happy-dom
// Plugins (Capabilities before #2104), 2026-10-28 regressions:
//   - the install scope stays under the title on every tab (it vanished on
//     Providers and the tabs jumped up); on Providers it shows turned
//     off, with the reason;
//   - no "N connected" button any more (the owner: it repeated Installed):
//     Discover is the first tab, the count sits on Installed and My
//     accounts, the close button keeps clear of the title row;
//   - a plugin's page opens inside its tab (title, scope and tabs kept, a
//     back row as a Settings sub-page), with the app's real mark, its name
//     once, the technical id as metadata, where it is installed and its main
//     action.
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
  scope: createElement("div", { "data-test-scope": "" }, "SCOPE"),
  installed: "I", discover: "D", pages: "G", sources: "S", ...extra,
}));

describe("the scope bar on every tab", () => {
  it("draws the scope above the tabs on each tab", () => {
    for (const tab of TABS) {
      const html = view(tab);
      expect(html, tab).toMatch(/data-plugins-scope-slot[\s\S]*?data-test-scope[\s\S]*?role="tablist"/);
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

describe("the header and the tab row", () => {
  it("Installed first, then Discover and Sources (#2104); no N connected button", () => {
    expect(CONNECT_APPS_TABS).toEqual(["installed", "discover", "bots", "pages", "sources"]);
    const html = view("installed", { counts: { installed: 6 } });
    expect(html).not.toContain("data-plugins-connected");
    expect(html).toMatch(/<header[^>]*><h2 id="plugins-title"[^>]*>Plugins<\/h2><div class="[^"]*" data-plugins-scope-row="true"><div class="shrink-0" data-plugins-scope-slot/);
  });

  it("one refresh button, one tab row, one scope slot: no option twice (#2104)", () => {
    const html = view("installed", { counts: { installed: 6 } });
    expect(html.match(/role="tablist"/g)).toHaveLength(1);
    expect(html.match(/data-plugins-scope-slot/g)).toHaveLength(1);
    expect(html.match(/aria-label="Refresh[^"]*"/g)).toHaveLength(1);
  });

  it("a click on a tab with a counter opens that tab", () => {
    const onTab = vi.fn();
    flushSync(() => root.render(createElement(ConnectAppsView, { tab: "discover", onTab, counts: { installed: 6 }, refreshing: false, onRefresh: noop })));
    const installed = host.querySelector<HTMLButtonElement>('[data-plugins-tab="installed"]')!;
    expect(installed.querySelector("[data-plugins-tab-count]")?.textContent).toBe("6");
    flushSync(() => installed.click());
    expect(onTab).toHaveBeenCalledWith("installed");
  });

  it("the title row keeps clear of the close button at every width", () => {
    expect(CATEGORY_MODAL.titleBar).toContain("pr-12");
    expect(CATEGORY_MODAL.titleBar).not.toMatch(/\bsm:px-/);
  });
});

describe("a plugin's page in its tab", () => {
  it("keeps the title, the scope and the tabs; the tab it came from stays marked", () => {
    const html = view("installed", { page: createElement("div", { "data-test-page": "" }, "PAGE") });
    expect(html).toMatch(/id="plugins-title"[^>]*>Plugins<\/h2>[\s\S]*?data-test-scope[\s\S]*?role="tablist"[\s\S]*?data-plugins-subpage[\s\S]*?data-test-page/);
    expect(html).toMatch(/aria-selected="true"[^>]*aria-current="page"[^>]*data-plugins-tab="installed"/);
    // the tab's own list is not drawn under the page
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

  it("shows the name once, where it is installed and the main action; the back row names the tab", () => {
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
    expect(host.querySelector("[data-breadcrumb-crumb='0']")?.textContent).toBe("Installed");
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
