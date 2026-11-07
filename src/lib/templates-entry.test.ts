// Browse Bots is the one place for templates (src/lib/templates-entry.ts).
// Connect apps' "Browse Bots" row, New bot's "Browse templates" button and
// an install link go through templatesEntryActions. The sidebar's Browse Bots
// row opens the catalogue's home view, not Templates.
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: () => new Promise(() => {}), useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch }) };
});

import { initialState, reducer } from "@/state/store";
import { BotCreationDraft, EMPTY_BOT_DEFAULTS } from "@/lib/bot-creation-draft";
import { StartingRole, startOptions } from "@/components/NewBotDialog";
import { PillSelect } from "@/components/SettingsPrimitives";
import { PluginsPanel } from "@/components/PluginsPanel";
import { PluginsPanelView } from "@/components/PluginsPanel.tsx-parts/PluginsPanelView";
import { ConnectAppsView } from "@/components/plugins/ConnectAppsView";
import { templatesEntryActions } from "./templates-entry";

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; onBotTemplates?: () => void; "data-new-bot-browse-templates"?: string; "data-new-bot-start"?: boolean; value?: string; onChange?: (value: never) => void }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  // the panel hands its body to its frame as a prop (content), not children
  const slots = Object.entries(node.props as Record<string, unknown>)
    .filter(([key, prop]) => key !== "children" && isValidElement(prop))
    .map(([, prop]) => prop as ReactNode);
  return [node, ...Children.toArray(node.props.children).flatMap(nodes), ...slots.flatMap(nodes)];
}

const templates = { type: "openBotCatalog", section: "templates" };

describe("the templates entry points", () => {
  it("close what they sit in, then open Browse Bots on Templates", () => {
    expect(templatesEntryActions("connectApps")).toEqual([{ type: "togglePlugins", open: false }, templates]);
    expect(templatesEntryActions("newBot")).toEqual([{ type: "toggleNewBot", open: false }, templates]);
    expect(templatesEntryActions("botWizard")).toEqual([{ type: "closeBotWizard" }, templates]);
    expect(templatesEntryActions("installLink", "https://github.com/acme/team")).toEqual([{ ...templates, installUrl: "https://github.com/acme/team" }]);
  });

  it("leave the store with the Browse Bots window open on Templates, and Connect apps and New bot closed", () => {
    for (const entry of ["connectApps", "newBot"] as const) {
      // each entry from the window it sits in
      const busy = entry === "connectApps" ? { ...initialState, pluginsOpen: true } : { ...initialState, newBotOpen: true };
      const after = templatesEntryActions(entry).reduce(reducer, busy);
      // Browse Bots is its own centred window again (619b200c8, windows
      // stay windows); Connect apps' Bots tab only embeds the same pane.
      expect(after.botCatalogOpen).toBe(true);
      expect(after.pluginsOpen).toBe(false);
      expect(after.botCatalogTarget).toEqual({ section: "templates" });
      expect(after.newBotOpen).toBe(false);
    }
    const linked = templatesEntryActions("installLink", "openmaus://install?u=x").reduce(reducer, initialState);
    expect(linked.botCatalogOpen).toBe(true);
    expect(linked.botCatalogTarget).toEqual({ section: "templates", installUrl: "openmaus://install?u=x" });
    // Closing the window forgets the target; closing Connect apps does not
    // touch the open window's target.
    expect(reducer(linked, { type: "closeBotCatalog" }).botCatalogTarget).toBeNull();
    expect(reducer(linked, { type: "togglePlugins", open: false }).botCatalogTarget).toEqual(linked.botCatalogTarget);
  });

  it("New bot's Browse templates button dispatches them (not in the defaults editor)", () => {
    fixture.dispatch.mockReset();
    const draft = new BotCreationDraft(EMPTY_BOT_DEFAULTS, () => {});
    let tree!: ReturnType<typeof StartingRole>;
    const html = renderToStaticMarkup(createElement(() => { tree = StartingRole({ draft, defaultsMode: false }); return tree; }));
    // one of the ways to start, in the Start from menu (owner 2026-10-14),
    // a pill menu since the windows took Settings' look (2026-10-16)
    expect(html).toContain("data-new-bot-start");
    const browse = startOptions([], false, false).find((option) => option.label === "Template from the catalog…");
    expect(browse?.group).toBe("Other ways to start");
    nodes(tree).find((node) => node.type === PillSelect)?.props.onChange?.(browse!.value as never);
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual(templatesEntryActions("newBot"));
    expect(startOptions([], true, true).map((option) => option.label)).not.toContain("Template from the catalog…");
  });

  it("Connect apps no longer offers Browse Bots (Owner 2026-10-14)", () => {
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    // the panel's markup lives in PluginsPanelView since the split: render it
    // with the props PluginsPanel hands it
    let tree!: ReturnType<typeof PluginsPanelView>;
    renderToStaticMarkup(createElement(() => {
      const panel = PluginsPanel() as ReactElement<Parameters<typeof PluginsPanelView>[0]>;
      expect(panel.type).toBe(PluginsPanelView);
      tree = PluginsPanelView(panel.props);
      return null;
    }));
    const view = nodes(tree).find((node) => node.type === ConnectAppsView);
    expect(view).toBeDefined();
    expect(view?.props.onBotTemplates).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
