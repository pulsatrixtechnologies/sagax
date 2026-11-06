import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { viewerCan } from "@/lib/viewer";
import type { SkillsLibrarySkillWire } from "../../../shared/wire";
import { TAILSCALE_KEY, buildPluginItems, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import { fetchBotTailscale, type BotTailscaleView } from "@/lib/bot-tailscale";
import { GROK_CLOUD_CONNECTORS } from "../../../shared/grok-cloud-connectors";
import { grokProviderConfigured } from "@/lib/providers-model";
import {
  loadBotPlugins,
  PERSONAL_PLUGIN_TARGET,
  type BotPluginsView,
} from "@/lib/my-connections";
import { botScopeMarketplaces, initialPluginScope, pluginScopeBot, type PluginScope } from "@/lib/plugin-scope";
import { useMcpServers } from "../McpServersPanel";
import { useServerMode } from "../ServerModeSettings";
import { isProvidersLink, normalizeConnectAppsTab, type ConnectAppsTab } from "../plugins/ConnectAppsView";
import { useBotCatalogSources } from "../bot-catalog/use-bot-catalog-sources";
import type { SearchGroupId } from "@/lib/connect-apps-search";
import { isBackShortcut, pageKeyAction } from "@/lib/back-shortcut";
import { BotCatalogPane } from "../lazy-bot-catalog";
import { loadMacApps } from "@/lib/mac-apps-setup";
import { macAppsSectionVisible, type MacAppsSetupStatus } from "../../../shared/mac-apps-setup.ts";
import { useBotCapabilities } from "@/lib/capabilities";
import type { DataCenter } from "../plugins/DataCenterDialog";
import { useHarnessConnectors } from "./useHarnessConnectors";
import type { FeaturedListing, MarketplaceListing, Page } from "./types";

/** Navigation, scope, catalog loads and derived item lists for PluginsPanel. */
export function usePluginsPanelState() {
  const { state, dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const dialogRef = useRef<HTMLDivElement>(null);
  const mcp = useMcpServers();
  const [stack, setStack] = useState<Page[]>([{ page: "main" }]);
  const page = stack[stack.length - 1]!;
  /** Open a page above the current one. */
  const push = useCallback((next: Page) => setStack((current) => [...current, next]), []);
  /** Back to the page at this depth (0: Connect apps). */
  const popTo = useCallback((depth: number) => setStack((current) => current.slice(0, Math.max(1, depth + 1))), []);
  /** A detail page after an install: in place of the detail it came from
   * (no second crumb for the same item), else above the current page. */
  const showDetail = useCallback((key: string) => setStack((current) => {
    const rest = current[current.length - 1]?.page === "detail" && current.length > 1 ? current.slice(0, -1) : current;
    return [...rest, { page: "detail", key }];
  }), []);
  const botsBack = useRef<(() => boolean) | null>(null);
  // Browse Bots' lists, read once for the Bots tab and the search
  const botSources = useBotCatalogSources({ remoteClient });
  /** a bot or a template the search opened in the Bots tab */
  const [botFocus, setBotFocus] = useState<{ key: string; nonce: number } | null>(null);
  // The one search (2026-10-29): what it found, the groups opened past
  // their first rows, the row the keyboard lit
  const [search, setSearch] = useState("");
  const [openedGroups, setOpenedGroups] = useState<ReadonlySet<SearchGroupId>>(() => new Set());
  const [activeResult, setActiveResult] = useState(-1);
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [type, setType] = useState<PluginTypeFilter>("any");
  // The Connect Apps home is where a person lands (#2104, 2026-11-06: as
  // Grok Bot; Installed was the landing on 2026-11-05: what they have,
  // then Discover to add; Discover was first from 2026-10-28 to then).
  const [tab, setTab] = useState<ConnectAppsTab>("discover");
  const harness = useHarnessConnectors();
  const claudeConnectors = harness.connected;
  const ownerOrAdmin = useOwnerOrAdmin();
  // 2026-10-09: a profile with skills.library changes the library too.
  const libraryEditor = ownerOrAdmin === true || (ownerOrAdmin === false && viewerCan(state.config, "skills.library"));
  const serverMode = useServerMode();
  const perspicaxOrg = usePerspicaxOrg();
  const organization = Boolean(serverMode?.active) || perspicaxOrg !== null;
  const mayManageOrganization = organization ? perspicaxOrg?.viewerRole === "admin" : ownerOrAdmin === true;
  const [featured, setFeatured] = useState<FeaturedListing[] | null>(null);
  const [dataCenterFor, setDataCenterFor] = useState<{ item: PluginItem; regions: DataCenter[]; defaultUrl: string; anchor: HTMLElement } | null>(null);
  // Plugins > This Mac: only in the desktop app on macOS (never on Windows,
  // Linux or the web); solo reads the local server, an organization server
  // reads this Mac over IPC (src/lib/mac-apps-setup.ts).
  const macAppsVisible = macAppsSectionVisible(typeof window === "undefined" ? null : window.ogb);
  const [macAppsSetup, setMacAppsSetup] = useState<MacAppsSetupStatus | null>(null);
  useEffect(() => {
    if (!macAppsVisible) return;
    let alive = true;
    loadMacApps().then((status) => { if (alive) setMacAppsSetup(status); }, () => { if (alive) setMacAppsSetup(null); });
    return () => { alive = false; };
  }, [page.page, macAppsVisible]);
  useEffect(() => {
    const openMacMessages = () => {
      setTab("installed");
      setStack([{ page: "main" }, { page: "mac-messages" }]);
    };
    window.addEventListener("sagax:open-mac-messages", openMacMessages);
    return () => window.removeEventListener("sagax:open-mac-messages", openMacMessages);
  }, []);
  const [skills, setSkills] = useState<SkillsLibrarySkillWire[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [mcpAccountDraft, setMcpAccountDraft] = useState<{ server: string; label: string } | null>(null);
  const [marketplaces, setMarketplaces] = useState<MarketplaceListing[] | null>(null);
  const [marketBusy, setMarketBusy] = useState<string | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  /** the git host refused "add" or a marketplace's refresh: offer a token */
  const [marketNeedsToken, setMarketNeedsToken] = useState<string | null>(null);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  /** the workspace's marketplace routes answered (its managers only) */
  const [workspaceMarkets, setWorkspaceMarkets] = useState(false);
  const scopeBot = pluginScopeBot({ pluginsBotId: state.pluginsBotId, selectedId: state.selectedId, bots: state.bots });
  const scopeBotId = scopeBot?.id ?? null;
  const [scopeChoice, setScopeChoice] = useState<PluginScope>(() => initialPluginScope(state.pluginsBotId, scopeBot));
  const scope: PluginScope = (scopeChoice === "bot" && !scopeBot) || (scopeChoice === "workspace" && !mayManageOrganization) ? "me" : scopeChoice;
  const [botView, setBotView] = useState<BotPluginsView | null>(null);
  const [personalView, setPersonalView] = useState<BotPluginsView | null>(null);
  const scopeBotIdRef = useRef(scopeBotId);
  scopeBotIdRef.current = scopeBotId;
  const scopedPluginView = scope === "me" ? personalView : botView;
  const scopedPluginTarget = scope === "me" ? PERSONAL_PLUGIN_TARGET : scopeBotId;
  const scopedPluginName = scope === "me" ? t("connectApps.scope.me") : scopeBot?.name ?? "";
  const setScopedPluginView = (view: BotPluginsView, target: typeof scopedPluginTarget | null = scopedPluginTarget) => {
    if (typeof target !== "string") setPersonalView(view);
    else if (scopeBotIdRef.current === target) setBotView(view);
  };
  // the bot's one resolved list (lot 1b): its engine, its organization Flow
  // and Roles for Installed, read again after each change of its plugins
  const orgRevision = state.config?.orgCapabilities?.revision;
  const capabilityRevision = useMemo(() => ({ botView, personalView, skills, marketplaces, orgRevision }), [botView, personalView, skills, marketplaces, orgRevision]);
  const botCapabilities = useBotCapabilities(scopeBotId, { revision: capabilityRevision });
  const [botBusy, setBotBusy] = useState<string | null>(null);

  const loadFeatured = useCallback(() => api("/api/plugins/search?registry=0")
    .then((result) => setFeatured(result.featured ?? []))
    .catch(() => setFeatured([])), []);
  const skillsRoute: "/api/me/skills-library" | "/api/skills-library" = scope === "me" ? "/api/me/skills-library" : "/api/skills-library";
  const skillsRouteRef = useRef(skillsRoute);
  skillsRouteRef.current = skillsRoute;
  const loadSkills = useCallback(() => api(skillsRoute)
    .then((result) => { if (skillsRouteRef.current === skillsRoute) setSkills(result.skills ?? []); })
    // the skills library is an option: off, there are no private skills
    .catch(() => { if (skillsRouteRef.current === skillsRoute) setSkills([]); }), [skillsRoute]);
  const loadMarketplaces = useCallback(() => api("/api/marketplaces")
    .then((result) => {
      setMarketplaces(result.marketplaces ?? []);
      setWorkspaceMarkets(true);
    })
    // only an admin or this computer's owner manages marketplaces; a member
    // reads the same list through a bot ("For this bot")
    .catch(() => {
      setMarketplaces([]);
      setWorkspaceMarkets(false);
    }), []);
  const loadBotView = useCallback(async () => {
    if (!scopeBotId) {
      setBotView(null);
      return;
    }
    try {
      const view = await loadBotPlugins(scopeBotId);
      if (scopeBotIdRef.current === scopeBotId) setBotView(view);
    } catch {
      if (scopeBotIdRef.current === scopeBotId) setBotView(null);
    }
  }, [scopeBotId]);
  const loadPersonalView = useCallback(async () => {
    try { setPersonalView(await loadBotPlugins(PERSONAL_PLUGIN_TARGET)); }
    catch (cause) { setPersonalView(null); setPanelError(readableError(cause)); }
  }, []);
  useEffect(() => {
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
  }, [loadFeatured, loadSkills, loadMarketplaces]);
  useEffect(() => {
    void loadBotView();
    void loadPersonalView();
  }, [loadBotView, loadPersonalView]);

  const close = useCallback(() => dispatch({ type: "togglePlugins", open: false }), [dispatch]);
  // A link to one tab of Connect apps: Pages (the published pages, moved
  // here from Settings 2026-10-26, a tab of their own since 2026-10-28),
  // Providers (once My accounts), Sources (the organization's sources and
  // access, Settings > Organization, 2026-10-27) or Bots (every link to
  // Browse Bots, 2026-10-29; a link to its Templates opens them there).
  const requestedTab = normalizeConnectAppsTab(state.pluginsPage);
  const botCatalogTarget = state.botCatalogTarget;
  useEffect(() => {
    const providersLink = isProvidersLink(state.pluginsPage);
    if (requestedTab === null || (requestedTab !== "pages" && !providersLink && requestedTab !== "sources" && requestedTab !== "bots")) return;
    if (requestedTab !== "bots") setScopeChoice("workspace");
    setStack([{ page: "main" }]);
    setSearch("");
    setTab(requestedTab);
    // the old Providers tab: Installed, on its Providers section
    if (providersLink) revealLater("[data-plugins-providers]");
  }, [requestedTab, botCatalogTarget]);
  const skillsLibraryOn = skillsLibraryEnabled(state.config);
  const back = useCallback(() => setStack((current) => current.length > 1 ? current.slice(0, -1) : current), []);
  useEffect(() => { void BotCatalogPane.preload().catch(() => undefined); }, []);

  /** Bring a row of the tab just opened into view, its first control
   * focused, once it is drawn (a list may still be reading). */
  const revealLater = (selector: string) => {
    let tries = 0;
    const look = () => {
      const row = dialogRef.current?.querySelector<HTMLElement>(selector);
      if (row) {
        row.scrollIntoView?.({ block: "center" });
        const control = row.querySelector<HTMLElement>("button:not([disabled]), a[href], input:not([disabled])");
        (control ?? row).focus?.({ preventScroll: true });
        return;
      }
      tries += 1;
      if (tries < 40) window.setTimeout(look, 100);
    };
    window.setTimeout(look, 0);
  };

  // Focus and keys (centred modal, decided exception like Settings): Escape
  // steps back one page (the Bots tab's own steps first), then closes;
  // Cmd+[ steps back and never closes. A search with text takes Escape
  // first: it empties (ConnectAppsSearch). Tab stays inside the dialog.
  const pageRef = useRef(page);
  pageRef.current = page;
  const botsTabRef = useRef(false);
  botsTabRef.current = tab === "bots" && page.page === "main" && search.trim() === "";
  const depthRef = useRef(stack.length - 1);
  depthRef.current = stack.length - 1;
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    (dialog?.querySelector<HTMLElement>("input") ?? focusable()[0] ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || isBackShortcut(event)) {
        // A dialog opened inside this one (Browse Bots' confirmations) owns its keys.
        const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
        if (event.defaultPrevented || (nested && nested.getClientRects().length > 0)) return;
        if (document.body.querySelector("[data-data-center-dialog]")) return;
        event.preventDefault();
        const action = pageKeyAction(event, { depth: depthRef.current, innerBack: botsTabRef.current ? () => botsBack.current?.() ?? false : undefined });
        if (action === "back") back();
        else if (action === "close") close();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus();
    };
  }, [back, close]);

  // The bot scope reads the same marketplaces through the bot: installed
  // there means on that bot.
  const shownMarketplaces = useMemo<MarketplaceListing[] | null>(
    () => (scope !== "workspace" ? (scopedPluginView ? botScopeMarketplaces(scopedPluginView) : null) : marketplaces),
    [scope, scopedPluginView, marketplaces],
  );
  const grokConfigured = grokProviderConfigured(state.instances);
  const [tailscaleView, setTailscaleView] = useState<BotTailscaleView | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchBotTailscale()
      .then((view) => { if (!cancelled) setTailscaleView(view); })
      .catch(() => { /* row stays available; the page loads its own error */ });
    return () => { cancelled = true; };
  }, []);
  const items = useMemo(() => buildPluginItems({
    servers: mcp.servers,
    featured,
    skills,
    marketplaces: shownMarketplaces,
    whop: { description: t("whop.description"), server: mcp.whopServer?.name, connected: mcp.whopConnected },
    tailscale: {
      description: t("connectApps.tailscale.rowDescription"),
      connected: tailscaleView?.phase === "connected",
      pending: tailscaleView?.phase === "pending_approval" || tailscaleView?.phase === "joining",
    },
    grok: grokConfigured ? { connectors: GROK_CLOUD_CONNECTORS, description: t("connectApps.grok.description") } : null,
  }), [mcp.servers, featured, skills, shownMarketplaces, mcp.whopServer?.name, mcp.whopConnected, grokConfigured, tailscaleView?.phase]);
  // For a bot, only marketplace plugins: apps, servers and skills are the
  // workspace's (a bot chooses among them in its own Access). Tailscale is
  // person-scoped (sealed vault + bot computer join), so it stays visible
  // under Me and workspace.
  const scopedItems = useMemo(() => {
    if (scope === "workspace") return items;
    return items.filter((item) =>
      item.key === TAILSCALE_KEY
      || item.kind === "plugin"
      || (scope === "me" && item.kind === "skill"));
  }, [scope, items]);

  const refreshAll = () => {
    void mcp.load(true);
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
    void loadBotView();
    void loadPersonalView();
  };
  const refreshing = mcp.busy === "load";

  /** A tab: that tab's list (a page opened from a tab closes). */
  const chooseTab = (next: ConnectAppsTab) => {
    setStack([{ page: "main" }]);
    setTab(next);
  };

  return {
    state, dispatch, dialogRef, mcp, stack, setStack, page, push, popTo, showDetail, botsBack,
    botSources, botFocus, setBotFocus, search, setSearch, openedGroups, setOpenedGroups,
    activeResult, setActiveResult, filter, setFilter, type, setType, tab, setTab,
    harness, claudeConnectors, ownerOrAdmin, libraryEditor,
    perspicaxOrg, organization, mayManageOrganization, featured, setFeatured, dataCenterFor, setDataCenterFor,
    macAppsVisible, macAppsSetup, skills, setSkills, installing, setInstalling, panelError, setPanelError,
    mcpAccountDraft, setMcpAccountDraft, marketplaces, setMarketplaces, marketBusy, setMarketBusy,
    marketError, setMarketError, marketNeedsToken, setMarketNeedsToken, panelNotice, setPanelNotice,
    workspaceMarkets, scopeBot, scopeBotId, setScopeChoice, scope, botView, personalView,
    scopedPluginView, scopedPluginTarget, scopedPluginName, setScopedPluginView, orgRevision, botCapabilities,
    botBusy, setBotBusy, loadFeatured, skillsRoute, loadSkills, loadMarketplaces, loadBotView,
    loadPersonalView, close, skillsLibraryOn, back, revealLater, shownMarketplaces, grokConfigured,
    tailscaleView, setTailscaleView, items, scopedItems, refreshAll, refreshing, chooseTab,
  };
}

export type PluginsPanelState = ReturnType<typeof usePluginsPanelState>;
