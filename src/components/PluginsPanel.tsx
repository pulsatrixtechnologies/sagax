// Plugins: one panel, after the "Connect apps" screens people know from
// desktop assistants.
//
//   - Connect apps (2026-10-27, the owner: one place per subject): one page with
//     its title, the scope, one search that looks everywhere (2026-10-29,
//     ConnectAppsSearch.tsx) and six tabs. Discover (where a person lands:
//     the catalog, the category pills and a link to Bots), Bots (Browse
//     Bots, a tab of its own since 2026-10-29: every link to Browse Bots
//     opens it),
//     Installed (one line per thing, deduplicated, with a "..." menu:
//     Update, For which bots, Remove; the private skills), Providers (the
//     connectors of their engine accounts and their own MCP servers, with a
//     pill per service), Pages (their published pages) and Sources (a
//     GitHub connection row, the marketplaces, and for an organization
//     admin the allowed marketplaces). "N connected" opens Installed, or
//     Providers when only engine connectors are connected (#1194).
//   - Detail: one plugin's accounts, tools (a switch per MCP tool, applied to
//     every bot) and details, with Uninstall.
//   - GitHub (owner, 2026-10-29: "Why is GitHub listed as a provider?"):
//     the person's GitHub account, the one GitHub connection of every use,
//     with the other credentials beside it, is on the GitHub plugin's page
//     (its detail page, installed or listed in Discover). With no GitHub
//     plugin in any marketplace, a page of its own with that one section.
//     Every link to it goes through `openGithub`.
//
// Two install scopes on one marketplace list (src/lib/plugin-scope.ts):
// everyone (a marketplace plugin's MCP servers and skills) or, when a bot is
// in reach, "For <bot>" (the whole plugin, agents and commands included, on
// that bot only; its owner or a person who manages it).
//
// This panel is the only place that adds, removes, configures or lists
// plugins, servers, apps, skills and marketplaces. Other screens link here
// or choose among them for one bot; keys stay in Settings > API keys.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";

import { api, ApiError, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { readableOr } from "../../shared/human-id";
import { isWhopServer } from "@/lib/whop-integration";
import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { viewerCan } from "@/lib/viewer";
import { permissionMissingText } from "@/lib/permissions";
import { canEditBotField } from "@/lib/bot-capabilities";
import { canEditConfig } from "@/lib/viewer";
import { detailIdentity, discoverItems, installedEntries, privateSkills, type InstalledEntry } from "@/lib/installed-model";
import { engineGetsNothing, enginesLine, organizationRows, useBotCapabilities } from "@/lib/capabilities";
import type { CapabilityForm, EngineParts } from "../../shared/capabilities";
import type { SkillsLibrarySkillWire } from "../../shared/wire";
import { WHOP_KEY, buildPluginItems, isGrokConnector, marketplacePluginKey, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import { GROK_CLOUD_CONNECTORS, GROK_CONNECTORS_URL } from "../../shared/grok-cloud-connectors";
import { grokProviderConfigured } from "@/lib/providers-model";
import { openExternalLink } from "@/lib/app-links";
import {
  addMarketplace as addBotMarketplace,
  installPlugin as installBotPlugin,
  loadBotPlugins,
  PERSONAL_PLUGIN_TARGET,
  type PluginTarget,
  MARKETPLACE_ACCESS_CODES,
  removeMarketplace as removeBotMarketplace,
  setPluginConfig as setBotPluginConfig,
  setPluginEnabled as setBotPluginEnabled,
  uninstallPlugin as uninstallBotPlugin,
  updateMarketplace as updateBotMarketplace,
  type BotPluginsView,
  type MarketplaceVisibility,
} from "@/lib/my-connections";
import { botPluginState, botScopeMarketplaces, initialPluginScope, marketplaceRoute, pluginScopeBot, marketplaceCredentialControls, type PluginScope } from "@/lib/plugin-scope";
import { openSettings } from "@/lib/settings-link";
import { GithubAccountSection } from "./plugins/GithubAccountSection";
import {
  ClaudeMcpSwitch,
  McpAuthLine,
  McpClientForm,
  McpImportForm,
  McpMessages,
  McpReservedServers,
  McpServerEditor,
  WhopAction,
  WhopBelow,
  isRemoteMcpListing,
  useMcpServers,
} from "./McpServersPanel";
import { MyGithubConnection, MyGithubSummary, MyMcpServers } from "./settings/MyConnectionsSettings";
import { useServerMode } from "./ServerModeSettings";
import { ConnectAppsView, connectAppsTabLabel, connectedCounts, isProvidersLink, normalizeConnectAppsTab, type ConnectAppsTab } from "./plugins/ConnectAppsView";
import type { Crumb } from "./Breadcrumb";
import { CATEGORY_MODAL, cardActionClass } from "./category-modal";
import { BotCatalogPane } from "./lazy-screens";
import { useBotCatalogSources } from "./bot-catalog/use-bot-catalog-sources";
import { catalogSections, type CatalogItem } from "@/lib/bot-catalog";
import { searchConnectApps, visibleResults, type SearchGroupId, type SearchPage, type SearchResult, type SearchSource } from "@/lib/connect-apps-search";
import { ConnectAppsSearchField, ConnectAppsSearchResults } from "./plugins/ConnectAppsSearch";
import type { PublishedPageSummary } from "../../shared/published-pages";
import { isBackShortcut, pageKeyAction } from "@/lib/back-shortcut";
import { InstalledView, type EntryActions } from "./plugins/InstalledView";
import { DiscoverView } from "./plugins/DiscoverView";
import { AccountsView, type AccountService } from "./plugins/AccountsView";
import { SourcesView } from "./plugins/SourcesView";
import { OrgSourcesAccess } from "./plugins/OrgSourcesAccess";
import { connectorGroups, type ClaudeUnavailable, type HarnessConnectorStatus } from "./plugins/HarnessConnectorGroups";
import { BotsForView, botServersAfter, botUsesServers } from "./plugins/BotsForView";
import { PublishedPagesSettings } from "./PublishedPages";
import { MarketplacesSection } from "./plugins/MarketplacesSection";
import { PluginPageHeader, PluginStatusLabel } from "./plugins/PluginParts";
import { pluginShareLink } from "@/lib/plugin-link";
import { DataCenterDialog, type DataCenter } from "./plugins/DataCenterDialog";
import { AddAccountButton, PluginDetailView, SignInButton, type DetailAccount, type DetailInstallState, type PluginDetailProps } from "./plugins/PluginDetailView";
import { SkillPage } from "./plugins/SkillPage";
import { ScopeToggle } from "./plugins/ScopeToggle";
import { BotPluginCard } from "./plugins/BotPluginCard";

interface MarketplaceListing {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  /** bots with plugins from it (the workspace list only) */
  bots?: number;
  /** a token is saved for it: the bot scope's bot, or everyone's (an admin's) in the workspace list; never the token */
  hasToken?: boolean;
  /** "private" (the person who added it) or "org" (shared with everyone) */
  visibility?: MarketplaceVisibility;
  /** this viewer added it, so may change its visibility */
  mine?: boolean;
  plugins: Array<{
    name: string; description?: string; version?: string; category?: string; installed: boolean; servers: string[]; skills: string[];
    installedVersion?: string; updateAvailable?: boolean;
  }>;
}

interface FeaturedListing {
  id: string; name: string; description: string; url: string; domain: string; auth: string; installed?: boolean; site?: string; category?: string; iconUrl?: string;
  /** the provider's data centers (Add asks which one first) */
  regions?: DataCenter[];
}

/** One page of the panel's window. The window keeps a stack of them (the
 * breadcrumb): Connect apps (its tabs) at the bottom, then what was opened
 * from it. */
type Page =
  | { page: "main" }
  /** an installed entry's "For which bots" */
  | { page: "botsFor"; key: string }
  | { page: "detail"; key: string }
  /** a private skill's page; no name: a new skill */
  | { page: "skill"; name?: string }
  /** the GitHub connection, when no marketplace has the GitHub plugin */
  | { page: "github" };

/** The GitHub plugin's page (2026-10-29), where the GitHub connection is:
 * the marketplace plugin named github, else one whose MCP server reads the
 * person's GitHub account; an installed one first. None: null. */
export function githubPluginKey(items: readonly PluginItem[]): string | null {
  const named = (item: PluginItem) => item.id.slice(0, item.id.lastIndexOf("@")) === "github";
  const reads = (item: PluginItem) => items.some((child) => child.parent === item.key && Boolean(child.githubAccount));
  const rank = (item: PluginItem) => (item.installed ? 0 : 2) + (named(item) ? 0 : 1);
  const found = items
    .filter((item) => item.kind === "plugin" && (named(item) || reads(item)))
    .sort((a, b) => rank(a) - rank(b));
  return found[0]?.key ?? null;
}

interface HarnessAnswer {
  manageUrl?: string;
  claude?: { available: boolean; reason?: ClaudeUnavailable; connectors?: Array<{ name: string; status: HarnessConnectorStatus }> };
  codex?: { available: boolean; connectors?: Array<{ name: string; status: HarnessConnectorStatus }>; manageUrl?: string };
}

/** The connectors of the person's own Claude account
 * (GET /api/me/harness-connectors): Providers lists them by engine, and
 * "N connected" counts the connected ones. */
function useHarnessConnectors() {
  const [answer, setAnswer] = useState<HarnessAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setAnswer(await api<HarnessAnswer>(`/api/me/harness-connectors${refresh ? "?refresh=1" : ""}`, { timeoutMs: 90_000 }));
    } catch {
      // no answer (an older server, a timeout): the Claude section says so
      // and offers to read again, it never vanishes (2026-10-28)
      setAnswer((current) => current ?? { claude: { available: false, reason: "unknown", connectors: [] } });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const connectors = answer?.claude?.available ? answer.claude.connectors ?? [] : [];
  return { answer, loading, load, connected: connectors.filter((connector) => connector.status === "connected").length };
}

/** The label of a plugin's source, for Manage and the details. */
export function pluginSourceLabel(source: string): string {
  if (source === "manual") return t("connectApps.source.manual");
  if (source === "catalog") return t("connectApps.source.catalog");
  if (source === "grok") return t("connectApps.source.grok");
  if (source === "local") return t("connectApps.skill.createdLocally");
  return source;
}

/** Opens grok.com/connectors; the sentence to show when no path opens it. */
export async function openGrokConnectors(): Promise<string | null> {
  try {
    await openExternalLink(GROK_CONNECTORS_URL);
    return null;
  } catch {
    return t("connectorSetup.blocked");
  }
}

/** "Manage on Grok": the only thing a Grok connector row offers. Sagax
 * neither connects it nor reads its account state. */
export function GrokConnectorAction() {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" data-grok-manage onClick={() => void openGrokConnectors().then(setError)} className={cn(cardActionClass("quiet"), "inline-flex items-center gap-1")}>
        <ExternalLink size={12} /> {t("connectApps.providers.manage", { provider: "Grok" })}
      </button>
      {error && <span role="alert" className="text-[11.5px] text-danger">{error}</span>}
    </span>
  );
}

/** The row action of an xAI connector, or undefined for any other row. */
export function grokRowAction(item: PluginItem): ReactNode | undefined {
  return isGrokConnector(item) ? <GrokConnectorAction /> : undefined;
}

/** The detail page of an xAI connector: managed on Grok, not connected here. */
export function grokConnectorDetail(item: PluginItem): Omit<PluginDetailProps, "onBack" | "onClose"> {
  return {
    item,
    subtitle: "grok.com/connectors",
    busy: false,
    accounts: [],
    accountAction: <GrokConnectorAction />,
    accountExtra: <p className="mt-2 text-[12px] text-ink-secondary">{t("connectApps.grok.detail")}</p>,
    details: [
      { label: t("connectApps.detail.source"), value: pluginSourceLabel("grok") },
      { label: t("connectApps.detail.accountsCount"), value: t("connectApps.grok.description") },
    ],
  };
}

export function PluginsPanel() {
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
  // Discover is where a person lands; the MCP surface (a bot's connectors,
  // the retro assistant) opens Installed, where the servers are.
  const [tab, setTab] = useState<ConnectAppsTab>(state.pluginsSurface === "mcp" ? "installed" : "discover");
  /** the pill Providers shows */
  const [accountService, setAccountService] = useState<AccountService>("all");
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
  const [dataCenterFor, setDataCenterFor] = useState<{ item: PluginItem; regions: DataCenter[]; defaultUrl: string } | null>(null);
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
  const setScopedPluginView = (view: BotPluginsView, target: PluginTarget | null = scopedPluginTarget) => {
    if (typeof target !== "string") setPersonalView(view);
    else if (scopeBotIdRef.current === target) setBotView(view);
  };
  // the bot's one resolved list (lot 1b): its engine, its organization Flow
  // and Roles for Installed, read again after each change of its plugins
  const capabilityRevision = useMemo(() => ({ botView, personalView, skills, marketplaces }), [botView, personalView, skills, marketplaces]);
  const botCapabilities = useBotCapabilities(scopeBotId, { revision: capabilityRevision });
  const [botBusy, setBotBusy] = useState<string | null>(null);

  const loadFeatured = useCallback(() => api("/api/plugins/search")
    .then((result) => setFeatured(result.featured ?? []))
    .catch(() => setFeatured([])), []);
  const skillsRoute = scope === "me" ? "/api/me/skills-library" : "/api/skills-library";
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

  // Focus and keys: Escape steps back one page (the Bots tab's own steps
  // first), then closes; Cmd+[ steps back and never closes. A search with
  // text takes Escape first: it empties (ConnectAppsSearch).
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
  const items = useMemo(() => buildPluginItems({
    servers: mcp.servers,
    featured,
    skills,
    marketplaces: shownMarketplaces,
    whop: { description: t("whop.description"), server: mcp.whopServer?.name, connected: mcp.whopConnected },
    grok: grokConfigured ? { connectors: GROK_CLOUD_CONNECTORS, description: t("connectApps.grok.description") } : null,
  }), [mcp.servers, featured, skills, shownMarketplaces, mcp.whopServer?.name, mcp.whopConnected, grokConfigured]);
  // For a bot, only marketplace plugins: apps, servers and skills are the
  // workspace's (a bot chooses among them in its own Access).
  const scopedItems = useMemo(() => (scope !== "workspace" ? items.filter((item) => item.kind === "plugin" || (scope === "me" && item.kind === "skill")) : items), [scope, items]);

  const refreshAll = () => {
    void mcp.load(true);
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
    void loadBotView();
    void loadPersonalView();
  };
  const refreshing = mcp.busy === "load";

  const openItem = (item: PluginItem) => {
    if (item.kind === "skill") {
      push({ page: "skill", name: item.id });
      return;
    }
    // Whop's page is its MCP server's page.
    const key = item.key === WHOP_KEY && mcp.whopServer ? `mcp:${mcp.whopServer.name}` : item.key;
    push({ page: "detail", key });
  };

  const installFeatured = async (item: PluginItem, region?: string) => {
    const listing = featured?.find((entry) => entry.id === item.id);
    if (region === undefined && listing?.regions?.length) {
      setDataCenterFor({ item, regions: listing.regions, defaultUrl: listing.url });
      return;
    }
    setInstalling(item.id);
    setPanelError(null);
    try {
      const result = await api("/api/plugins/install", { method: "POST", body: JSON.stringify({ id: item.id, ...(region ? { region } : {}) }) });
      await mcp.load();
      await loadFeatured();
      if (typeof result.authorizationUrl === "string") await openExternalLink(result.authorizationUrl);
      if (typeof result.name === "string") showDetail(`mcp:${result.name}`);
    } catch (cause) {
      setPanelError(readableError(cause));
    } finally {
      setInstalling(null);
    }
  };

  const marketAction = async (busy: string, work: () => Promise<unknown>): Promise<boolean> => {
    setMarketBusy(busy);
    setMarketError(null);
    setMarketNeedsToken(null);
    try {
      await work();
      return true;
    } catch (cause) {
      setMarketError(readableError(cause));
      // The git host refused (private, bad token, SAML sign-on): in the bot
      // scope, offer that bot's token field where it failed.
      if (cause instanceof ApiError && typeof cause.body?.code === "string" && MARKETPLACE_ACCESS_CODES.has(cause.body.code)) {
        if (busy === "add") setMarketNeedsToken("add");
        else if (busy.startsWith("refresh:")) setMarketNeedsToken(busy.slice("refresh:".length));
      }
      return false;
    } finally {
      setMarketBusy(null);
    }
  };
  // Add, refresh and remove go through the workspace's routes for its
  // managers, else through the bot's own for a person who may change that
  // bot's plugins: one list either way.
  const marketRoute = marketplaceRoute({ workspaceManager: workspaceMarkets && mayManageOrganization, scope, botView, personalView });
  const afterBotMarket = async (view: BotPluginsView) => {
    setScopedPluginView(view);
    if (workspaceMarkets) await loadMarketplaces();
  };
  const addMarketplace = (source: string, ref: string, visibility: MarketplaceVisibility, credential?: string) => marketAction("add", async () => {
    if ((marketRoute === "bot" || marketRoute === "me") && scopedPluginTarget) {
      await afterBotMarket(await addBotMarketplace(scopedPluginTarget, source, { ...(ref ? { ref } : {}), ...(credential ? { credential } : {}), visibility }));
      return;
    }
    const result = await api("/api/marketplaces", { method: "POST", body: JSON.stringify({ source, ...(ref ? { ref } : {}), ...(credential ? { credential } : {}), visibility }) });
    setMarketplaces(result.marketplaces ?? []);
    void loadBotView();
  });
  // Change a marketplace's visibility (the workspace Marketplaces page, for
  // a marketplace the viewer added). The server refuses org-wide to anyone
  // who may not share, and private-to-others is simply not found.
  const setMarketplaceVisibility = (name: string, visibility: MarketplaceVisibility) => void marketAction(`refresh:${name}`, async () => {
    const result = await api(`/api/marketplaces/${encodeURIComponent(name)}/visibility`, { method: "PUT", body: JSON.stringify({ visibility }) });
    setMarketplaces(result.marketplaces ?? []);
    void loadBotView();
  });
  const refreshMarketplace = (name: string) => void marketAction(`refresh:${name}`, async () => {
    if ((marketRoute === "bot" || marketRoute === "me") && scopedPluginTarget) {
      await afterBotMarket(await updateBotMarketplace(scopedPluginTarget, name));
      return;
    }
    const result = await api(`/api/marketplaces/${encodeURIComponent(name)}/refresh`, { method: "POST", body: "{}" });
    setMarketplaces(result.marketplaces ?? []);
    void loadBotView();
  });
  const removeMarketplace = (name: string) => {
    const fromBot = (marketRoute === "bot" || marketRoute === "me") && scopedPluginTarget;
    if (!window.confirm(fromBot ? t("connectApps.market.removeFromBotConfirm", { name, bot: scopedPluginName }) : t("connectApps.market.removeConfirm", { name }))) return;
    void marketAction(`remove:${name}`, async () => {
      if (fromBot) {
        const view = await removeBotMarketplace(fromBot, name);
        await afterBotMarket(view);
        if (!view.sharedRemoved) setPanelNotice(t("connectApps.market.keptForEveryone", { name }));
      } else {
        const result = await api(`/api/marketplaces/${encodeURIComponent(name)}`, { method: "DELETE" });
        setMarketplaces(result.marketplaces ?? []);
        void loadBotView();
      }
      if (filter === `source:${name}`) setFilter("all");
    });
  };
  // The GitHub connection: the person's GitHub account (organization
  // server) and the one credential list, in both scopes, on the GitHub
  // plugin's page (2026-10-29)
  const githubHere = organization || marketRoute !== null;
  const githubKey = githubPluginKey(items);
  const githubSection = githubHere ? <GithubAccountSection connection={organization ? <MyGithubConnection /> : undefined} /> : null;
  /** The GitHub plugin's page, in the current tab: where the GitHub
   * connection is (a page of its own when no marketplace has the plugin). */
  const openGithub = () => setStack([{ page: "main" }, githubKey ? { page: "detail", key: githubKey } : { page: "github" }]);
  /** Each marketplace picks a credential of the one list on the GitHub
   * plugin's page, or Automatic (2026-10-28): that bot's pick, or the
   * installation's for the workspace's managers; then it is fetched again. */
  const marketCredentials = (marketRoute === "me" || (marketRoute === "bot" && scopeBotId))
    ? marketplaceCredentialControls<MarketplaceListing>({ route: marketRoute, botId: scopeBotId ?? undefined, api, run: marketAction, botLoaded: afterBotMarket })
    : marketRoute === "workspace"
      ? marketplaceCredentialControls<MarketplaceListing>({ route: "workspace", api, run: marketAction, loaded: (list) => { setMarketplaces(list); void loadBotView(); } })
      : undefined;
  const marketSummaries = (marketRoute === "bot" || marketRoute === "me") && scopedPluginView
    ? botScopeMarketplaces(scopedPluginView)
    : marketRoute === "workspace" ? marketplaces : null;

  /** "For <bot>": the whole plugin on that one bot. */
  const botAction = async (busy: string, work: () => Promise<BotPluginsView>): Promise<void> => {
    setBotBusy(busy);
    setPanelError(null);
    try {
      setScopedPluginView(await work());
    } catch (cause) {
      setPanelError(readableError(cause));
    } finally {
      setBotBusy(null);
    }
  };
  const installForBot = (id: string) => {
    const at = id.lastIndexOf("@");
    if (!scopedPluginTarget || at <= 0) return;
    void botAction(`install:${id}`, () => installBotPlugin(scopedPluginTarget!, id.slice(at + 1), id.slice(0, at)));
  };
  const uninstallForBot = (id: string) => {
    if (!scopedPluginTarget || !window.confirm(scope === "me" ? t("connectApps.mePlugin.uninstallConfirm", { name: id.slice(0, id.lastIndexOf("@")) }) : t("connectApps.botPlugin.uninstallConfirm", { name: id.slice(0, id.lastIndexOf("@")), bot: scopedPluginName }))) return;
    void botAction(`remove:${id}`, () => uninstallBotPlugin(scopedPluginTarget!, id));
  };
  const toggleForBot = (id: string, enabled: boolean) => {
    if (!scopedPluginTarget) return;
    void botAction(`toggle:${id}`, () => setBotPluginEnabled(scopedPluginTarget!, id, enabled));
  };
  const botCard = (item: PluginItem): ReactNode => {
    if (!scopedPluginView || !scopedPluginTarget || item.kind !== "plugin") return null;
    const plugin = botPluginState(scopedPluginView, item.id);
    if (!plugin) return null;
    const busy = botBusy?.endsWith(`:${item.id}`) ? botBusy.slice(0, botBusy.indexOf(":")) : botBusy ? "other" : null;
    return (
      <BotPluginCard
        key={`${scope}:${item.key}`}
        installInHeader={scope !== "workspace"}
        personal={scope === "me"}
        botName={scopedPluginName}
        view={scopedPluginView}
        plugin={plugin}
        busy={busy}
        onInstall={() => installForBot(item.id)}
        onToggle={(enabled) => toggleForBot(item.id, enabled)}
        onUninstall={() => uninstallForBot(item.id)}
        onSaveConfig={async (values) => {
          if (!scopedPluginTarget) return;
          setScopedPluginView(await setBotPluginConfig(scopedPluginTarget, item.id, values));
        }}
      />
    );
  };
  /** A marketplace plugin's page header (2026-10-28): where it is installed
   * (for everyone, on the bot in reach) and its main action beside the name:
   * Install for <bot> in that bot's scope, else Update when one waits. */
  const detailHead = (item: PluginItem): Pick<PluginDetailProps, "installState" | "primaryAction"> => {
    if (item.kind !== "plugin") return {};
    const [plugin, marketplace] = [item.id.slice(0, item.id.lastIndexOf("@")), item.id.slice(item.id.lastIndexOf("@") + 1)];
    // the workspace's own install: this list in its scope, else the
    // workspace marketplaces when this person may read them
    const everyone = scope === "workspace"
      ? item.installed
      : marketplaces?.find((market) => market.name === marketplace)?.plugins.find((entry) => entry.name === plugin)?.installed ?? null;
    const onBot = scopedPluginTarget && scopedPluginView ? botPluginState(scopedPluginView, item.id) : null;
    const installState: DetailInstallState[] = [
      ...(everyone === null ? [] : [{ id: "everyone" as const, on: everyone, label: t(everyone ? "connectApps.detail.state.everyoneOn" : "connectApps.detail.state.everyoneOff") }]),
      ...(onBot ? [{ id: scope === "me" ? "me" as const : "bot" as const, on: Boolean(onBot.installed), label: scope === "me" ? t(onBot.installed ? "connectApps.mePlugin.installed" : "connectApps.mePlugin.notInstalled") : t(onBot.installed ? "connectApps.detail.state.botOn" : "connectApps.detail.state.botOff", { name: scopedPluginName }) }] : []),
    ];
    let primaryAction: ReactNode = null;
    if (scope !== "workspace" && onBot && !onBot.installed && scopedPluginView?.canChange) {
      const busy = botBusy === `install:${item.id}`;
      primaryAction = (
        <button type="button" data-plugins-detail-primary="install-bot" disabled={botBusy !== null} onClick={() => installForBot(item.id)} className={cn(cardActionClass("primary"), "gap-1.5")}>
          {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
          {busy ? t("plugins.installing") : (scope === "me" ? t("connectApps.mePlugin.install") : t("connectApps.botPlugin.install", { name: scopedPluginName }))}
        </button>
      );
    } else if (scope === "workspace" && item.installed && item.updateAvailable) {
      primaryAction = (
        <button type="button" data-plugins-detail-primary="update" disabled={installing !== null} onClick={() => void updatePlugin(item)} className={cn(cardActionClass("primary"), "gap-1.5")}>
          {installing === item.id && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
          {t("connectApps.plugin.update")}
        </button>
      );
    }
    return { installState, primaryAction };
  };
  /** What a page's capability brings, for its "Engines" line and the
   * warning before an install (lib/capabilities, shared engineReceipt): a
   * plugin for this bot brings its skills, commands and agents; for
   * everyone, its MCP servers and its skills through the library. */
  const engineParts = (item: PluginItem): { form: CapabilityForm; parts: Omit<EngineParts, "customMcp"> } | null => {
    if (item.source === "grok") return null;
    if (item.kind === "plugin") {
      const at = item.id.lastIndexOf("@");
      if (scope !== "workspace") {
        const plugin = botPluginState(scopedPluginView, item.id);
        const contents = plugin?.contents;
        return contents ? { form: "plugin", parts: { mcp: Boolean(plugin?.installed?.declaredMcpServers.length), skills: contents.skills.length > 0, commands: contents.commands.length > 0, agents: contents.agents.length > 0 } } : null;
      }
      const received = botCapabilities.data?.items.find((row) => row.key === `plugin:installation:${item.id}`)?.brings;
      if (received) return { form: "plugin", parts: { mcp: received.mcpServers.length > 0, skills: received.skills.length > 0, commands: received.commands.length > 0, agents: received.agents.length > 0 } };
      const entry = marketplaces?.find((market) => market.name === item.id.slice(at + 1))?.plugins.find((candidate) => candidate.name === item.id.slice(0, at));
      return entry ? { form: "plugin", parts: { mcp: entry.servers.length > 0, skills: entry.skills.length > 0, indexOnly: true } } : null;
    }
    if (item.kind === "mcp" || item.kind === "app" || item.kind === "featured") return { form: "mcp", parts: { mcp: true } };
    if (item.kind === "skill") return { form: "skill", parts: { skills: true, indexOnly: true } };
    return null;
  };
  /** The "Engines" row of a page's details, and the warning when the bot in
   * reach would receive nothing of it. */
  const engineInfo = (item: PluginItem): Pick<PluginDetailProps, "notice"> & { row: { label: string; value: string } | null } => {
    const what = engineParts(item);
    if (!what) return { row: null };
    const row = { label: t("capabilities.detail.engines"), value: enginesLine(what.form, what.parts) };
    const engine = botCapabilities.data?.engine;
    const warn = scopeBot && engine && engineGetsNothing(engine.kind, what.form, { ...what.parts, skillDiscovery: Boolean(botCapabilities.data?.promptIndex) });
    return {
      row,
      notice: warn ? (
        <p role="note" data-plugins-engine-warning className="flex items-start gap-1.5 rounded-xl bg-warning/10 px-3 py-2 text-[12px] leading-[17px] text-warning">
          {t("capabilities.detail.engineGetsNothing", { name: scopeBot.name, engine: engine.label })}
        </p>
      ) : undefined,
    };
  };
  /** Add on a marketplace plugin: its MCP servers and skills, for every bot. */
  const installPlugin = async (item: PluginItem) => {
    const [plugin, marketplace] = item.id.split("@") as [string, string];
    setInstalling(item.id);
    setPanelError(null);
    setPanelNotice(null);
    try {
      const result = await api(`/api/marketplaces/${encodeURIComponent(marketplace)}/plugins/${encodeURIComponent(plugin)}`, { method: "POST", body: "{}" });
      setMarketplaces(result.marketplaces ?? []);
      await Promise.all([mcp.load(), loadSkills()]);
      const skipped: string[] = Array.isArray(result.skipped) ? result.skipped : [];
      if (skipped.length) setPanelNotice(t("connectApps.plugin.skipped", { parts: skipped.join("; ") }));
      showDetail(marketplacePluginKey(marketplace, plugin));
    } catch (cause) {
      setPanelError(readableError(cause));
    } finally {
      setInstalling(null);
    }
  };
  /** Update in place: same server names, switches and bot choices. */
  const updatePlugin = async (item: PluginItem) => {
    const [plugin, marketplace] = item.id.split("@") as [string, string];
    setInstalling(item.id);
    setPanelError(null);
    setPanelNotice(null);
    try {
      const result = await api(`/api/marketplaces/${encodeURIComponent(marketplace)}/plugins/${encodeURIComponent(plugin)}/update`, { method: "POST", body: "{}" });
      setMarketplaces(result.marketplaces ?? []);
      await Promise.all([mcp.load(), loadSkills()]);
      const skipped: string[] = Array.isArray(result.skipped) ? result.skipped : [];
      setPanelNotice(skipped.length
        ? t("connectApps.plugin.skipped", { parts: skipped.join("; ") })
        : t("connectApps.plugin.updated", { name: plugin }));
    } catch (cause) {
      setPanelError(readableError(cause));
    } finally {
      setInstalling(null);
    }
  };
  const uninstallPlugin = async (item: PluginItem) => {
    const [plugin, marketplace] = item.id.split("@") as [string, string];
    if (!window.confirm(t("connectApps.plugin.uninstallConfirm", { name: plugin }))) return;
    setInstalling(item.id);
    setPanelError(null);
    try {
      const result = await api(`/api/marketplaces/${encodeURIComponent(marketplace)}/plugins/${encodeURIComponent(plugin)}`, { method: "DELETE" });
      setMarketplaces(result.marketplaces ?? []);
      await Promise.all([mcp.load(), loadSkills()]);
    } catch (cause) {
      setPanelError(readableError(cause));
    } finally {
      setInstalling(null);
    }
  };

  const renderAction = (item: PluginItem) => {
    const grokAction = grokRowAction(item);
    if (grokAction !== undefined) return grokAction;
    if (item.key === WHOP_KEY) return <WhopAction mcp={mcp} />;
    if (item.kind === "plugin") {
      if (scope !== "workspace") {
        // installed on this bot: Install again updates it in place (its
        // switch and install date stay, server/bot-plugins.ts)
        if (!scopedPluginView?.canChange || (item.installed && !item.updateAvailable)) return null;
        return (
          <button type="button" {...(item.installed ? { "data-bot-plugin-update": item.id } : { "data-bot-plugin-add": item.id })} disabled={botBusy !== null} onClick={() => installForBot(item.id)} className={cn(cardActionClass(item.installed ? "secondary" : "quiet"), "min-w-[76px]")}>
            {botBusy === `install:${item.id}` ? <Loader2 size={13} className="mx-auto animate-spin" /> : t(item.installed ? "connectApps.plugin.update" : "connectApps.action.add")}
          </button>
        );
      }
      if (item.installed && !item.updateAvailable) return null;
      if (item.installed) {
        return (
          <button type="button" disabled={installing !== null} onClick={() => void updatePlugin(item)} className={cn(cardActionClass("secondary"), "min-w-[76px]")} data-plugin-update>
            {installing === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : t("connectApps.plugin.update")}
          </button>
        );
      }
      return (
        <button type="button" disabled={installing !== null} onClick={() => void installPlugin(item)} className={cn(cardActionClass("quiet"), "min-w-[76px]")}>
          {installing === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : t("connectApps.action.add")}
        </button>
      );
    }
    if (item.kind === "featured") {
      return (
        <button type="button" disabled={installing !== null} onClick={() => void installFeatured(item)} className={cn(cardActionClass("quiet"), "min-w-[76px]")}>
          {installing === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : t(item.action === "connect" ? "connectApps.action.connect" : "connectApps.action.add")}
        </button>
      );
    }
    return null;
  };

  const renderBelow = (item: PluginItem) => {
    if (item.key === WHOP_KEY) return <WhopBelow mcp={mcp} />;
    return null;
  };

  const notices = (
    <>
      {panelError && <div role="alert" className="mx-6 mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger sm:mx-8">{panelError}</div>}
      {panelNotice && <div role="status" className="mx-6 mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning sm:mx-8">{panelNotice}</div>}
    </>
  );

  // The scope sits under the title on every tab (2026-10-28: it vanished on
  // Providers and the tabs jumped up). Providers lists the person's own
  // engine accounts and servers, which serve all of their bots: the scope
  // does not apply there, so it shows turned off with the reason in the
  // note's place. Every line keeps its room on every tab (a bot-only notice
  // is kept invisible on Providers), so the tabs never move.
  // Pages are the person's own too: the same turned-off scope
  // Bots too (2026-10-29): bots and templates are the same in both scopes
  const botsTab = tab === "bots" && page.page === "main" && search.trim() === "";
  const accountsTab = (tab === "pages" && page.page === "main") || botsTab;
  const scopeToggle = (
    <div data-plugins-scope-bar data-plugins-scope-tab={botsTab ? "bots" : accountsTab ? "accounts" : "plugins"}>
      <ScopeToggle scope={scope} botName={scopeBot?.name} organization={workspaceMarkets && mayManageOrganization} onScope={(next) => { setScopeChoice(next); setPanelError(null); }} disabled={accountsTab} describedBy={accountsTab ? "plugins-scope-note" : undefined} />
    </div>
  );
  const scopeControl = (
    <div data-plugins-scope-notes>
      <p id="plugins-scope-note" className="mt-2 min-h-[36px] text-[12px] leading-[18px] text-ink-secondary" data-plugins-scope-note={botsTab ? "bots" : accountsTab ? "accounts" : scope}>
        {botsTab ? t("connectApps.scope.botsNote") : accountsTab ? t("connectApps.scope.accountsNote") : scope === "bot" && scopeBot ? (
          <>
            {t("connectApps.scope.botNote", { name: scopeBot.name })}
            {botView && !botView.canChange && <> {t("plugins.readOnly")}</>}
          </>
        ) : t(scope === "me" ? "connectApps.scope.meNote" : "connectApps.scope.workspaceNote")}
      </p>
      <div className={cn(accountsTab && "invisible")} aria-hidden={accountsTab || undefined}>
        {scope !== "workspace" && scopedPluginView && scopedPluginView.marketplaces.length === 0 && (
          <p className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary" data-plugins-scope-empty>{t("connectApps.scope.noMarketplaces")}</p>
        )}
      </div>
    </div>
  );

  // Manage > Installed: one entry per thing (installed-model.ts).
  const entries = useMemo(() => installedEntries(scopedItems, featured ?? []), [scopedItems, featured]);
  const enabledServers = useMemo(() => (mcp.servers ?? []).filter((server) => server.enabled).map((server) => server.name), [mcp.servers]);
  // the person's bots whose MCP list they may change (their own, or any bot
  // on a solo installation)
  const editableBots = state.bots.filter((bot) => !bot.hidden && canEditBotField(state.config, bot, "mcpServers"));
  const botsForRows = (entry: InstalledEntry) => editableBots.map((bot) => ({ id: bot.id, name: bot.name, on: botUsesServers(bot.mcpServers, enabledServers, entry.servers) }));
  const toggleBotServers = (entry: InstalledEntry, botId: string, on: boolean) => {
    const bot = state.bots.find((candidate) => candidate.id === botId);
    if (!bot) return;
    dispatch({ type: "updateBot", botId, patch: { mcpServers: botServersAfter(bot.mcpServers, enabledServers, entry.servers, on) } });
  };
  /** Remove: the plugin (its servers and skills go with it) and every
   * server of the entry added by hand or from the catalog, after one
   * confirmation. */
  const removeEntry = async (entry: InstalledEntry) => {
    if (!window.confirm(t("connectApps.entry.removeConfirm", { name: entry.name }))) return;
    setPanelError(null);
    setInstalling(entry.key);
    try {
      const plugins = entry.members.filter((member) => member.kind === "plugin");
      const pluginKeys = new Set(plugins.map((plugin) => plugin.key));
      for (const plugin of plugins) {
        const [name, marketplace] = plugin.id.split("@") as [string, string];
        const result = await api(`/api/marketplaces/${encodeURIComponent(marketplace)}/plugins/${encodeURIComponent(name)}`, { method: "DELETE" });
        setMarketplaces(result.marketplaces ?? []);
      }
      for (const server of entry.members.filter((member) => member.kind === "mcp" && !(member.parent && pluginKeys.has(member.parent)))) {
        await api(`/api/mcp/servers/${encodeURIComponent(server.id)}`, { method: "DELETE" });
      }
      await Promise.all([mcp.load(true), loadSkills(), loadFeatured()]);
    } catch (cause) {
      setPanelError(readableError(cause));
      void mcp.load(true);
    } finally {
      setInstalling(null);
    }
  };
  const entryActions = (entry: InstalledEntry): EntryActions => {
    const plugin = entry.members.find((member) => member.kind === "plugin");
    if (scope !== "workspace") {
      if (!plugin || !scopedPluginView?.canChange) return {};
      return {
        ...(plugin.updateAvailable ? { update: () => installForBot(plugin.id) } : {}),
        remove: () => uninstallForBot(plugin.id),
      };
    }
    const removable = entry.members.some((member) => member.kind === "plugin" || member.kind === "mcp");
    return {
      ...(plugin?.updateAvailable ? { update: () => void updatePlugin(plugin) } : {}),
      ...(entry.servers.length > 0 ? { bots: () => push({ page: "botsFor", key: entry.key }) } : {}),
      ...(removable && !mcp.restricted ? { remove: () => void removeEntry(entry) } : {}),
    };
  };
  const botsForEntry = page.page === "botsFor" ? entries.find((entry) => entry.key === page.key) : undefined;

  const detailItem = page.page === "detail" ? items.find((item) => item.key === page.key) : undefined;
  // The breadcrumb: each page under the current one. A page opened from a
  // tab shows in that tab under Connect Apps' title: its first crumb is the
  // tab ("Installed"); Browse Bots too, from Discover (2026-10-28).
  const pageLabel = (entry: Page): string => {
    switch (entry.page) {
      case "main": return connectAppsTabLabel(tab);
      case "botsFor": return t("connectApps.entry.bots");
      case "detail": {
        const item = items.find((candidate) => candidate.key === entry.key);
        return item ? detailIdentity(item, entries).name : t("connectApps.back");
      }
      case "skill": return entry.name ?? t("connectApps.skill.new");
      case "github": return t("myConnections.github.title");
    }
  };
  const trail: Crumb[] = stack.slice(0, -1).map((entry, depth) => ({ label: pageLabel(entry), onSelect: () => popTo(depth) }));
  // An item that went away (uninstalled, or removed elsewhere) leaves its page.
  const detailMissing = page.page === "detail" && !detailItem && mcp.servers !== null && skills !== null && shownMarketplaces !== null;
  // A skill deleted or renamed elsewhere leaves its page too.
  const skillMissing = page.page === "skill" && Boolean(page.name) && skills !== null && !skills.some((entry) => entry.name === page.name);
  // An entry removed while its "For which bots" is open leaves it too.
  const botsForMissing = page.page === "botsFor" && !botsForEntry && mcp.servers !== null && shownMarketplaces !== null;
  useEffect(() => {
    if (detailMissing || skillMissing || botsForMissing) back();
  }, [detailMissing, skillMissing, botsForMissing, back]);
  // The GitHub page opened before the marketplaces answered: the GitHub
  // plugin's page, once it is known.
  const githubLate = page.page === "github" && githubKey !== null;
  useEffect(() => {
    if (!githubLate || !githubKey) return;
    setStack((current) => current[current.length - 1]?.page === "github" ? [...current.slice(0, -1), { page: "detail", key: githubKey }] : current);
  }, [githubLate, githubKey]);

  const skillsOn = skills !== null && skillsLibraryOn;
  const pageSkill = page.page === "skill" && page.name ? skills?.find((entry) => entry.name === page.name) : undefined;
  const skillReadOnly = (skill: SkillsLibrarySkillWire): string | undefined => {
    if (scope === "me") return undefined;
    if (ownerOrAdmin === false && !libraryEditor) return perspicaxOrg !== null ? permissionMissingText("skills.library") : t("connectApps.skill.readOnlyOwner");
    if (skill.version) return t("connectApps.skill.readOnlyOrganization");
    const plugin = marketplaces?.find((market) => market.name === skill.source)?.plugins.find((entry) => entry.installed && entry.skills.includes(skill.name));
    if (plugin) return t("connectApps.skill.readOnlyPlugin", { plugin: plugin.name });
    return undefined;
  };

  // A page opened from a tab (2026-10-28): inside that tab's panel, under
  // the title, scope and tabs. Browse Bots is the Bots tab (2026-10-29).
  let subpage: ReactNode = null;
  if (page.page === "skill" && (pageSkill || !page.name)) {
    subpage = (
      <SkillPage
        key={`${scope}:${page.name ?? "new"}`}
        basePath={skillsRoute}
        skill={pageSkill}
        readOnlyReason={pageSkill ? skillReadOnly(pageSkill) : undefined}
        onBack={back}
        trail={trail}
        onSaved={async (name) => {
          await loadSkills();
          setStack((current) => current.map((entry, index) => index === current.length - 1 && entry.page === "skill" ? { ...entry, name } : entry));
        }}
        onDeleted={async () => {
          await loadSkills();
          setStack((current) => current[current.length - 1]?.page === "skill" && current.length > 1 ? current.slice(0, -1) : current);
        }}
      />
    );
  } else if (page.page === "botsFor" && botsForEntry) {
    subpage = (
      <BotsForView
        name={botsForEntry.name}
        bots={botsForRows(botsForEntry)}
        onToggle={(botId, on) => toggleBotServers(botsForEntry, botId, on)}
        onBack={back}
        trail={trail}
      />
    );
  } else if (page.page === "github") {
    subpage = (
      <>
        <PluginPageHeader title={t("myConnections.github.title")} trail={trail} onBack={back} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-3 sm:px-8" data-plugins-github-page>
          {githubSection ?? <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("connectApps.manage.accountsEmpty")}</p>}
        </div>
      </>
    );
  } else if (page.page === "detail" && detailItem) {
    const identity = detailIdentity(detailItem, entries);
    const base = detailProps(detailItem, { mcp, mcpAccountDraft, setMcpAccountDraft, openGithub, githubKey, githubSection,
      items, marketplaces: shownMarketplaces, installing, openItem, uninstallPlugin: (item) => void uninstallPlugin(item), updatePlugin: (item) => void updatePlugin(item),
      scope, botCard: botCard(detailItem) });
    const engines = engineInfo(detailItem);
    subpage = (
      <PluginDetailView
        {...base}
        details={engines.row ? [...base.details, engines.row] : base.details}
        notice={engines.notice}
        {...detailHead(detailItem)}
        displayName={identity.name}
        icon={identity.icon}
        onBack={back}
        trail={trail}
      />
    );
  } else if (page.page === "detail" || page.page === "skill" || page.page === "botsFor") {
    subpage = (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary">
        <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
      </div>
    );
  }

  /** A tab: that tab's list (a page opened from a tab closes). */
  const chooseTab = (next: ConnectAppsTab) => {
    setStack([{ page: "main" }]);
    setTab(next);
  };

  // The one search (2026-10-29): every plugin, app, skill and server of the
  // scope, Browse Bots' bots and templates, the published pages and the
  // sources. The pages are read the first time the search has text.
  const searching = search.trim() !== "";
  const [searchPages, setSearchPages] = useState<SearchPage[] | null>(null);
  useEffect(() => {
    if (!searching || searchPages !== null) return;
    let alive = true;
    api<{ pages: PublishedPageSummary[] }>("/api/pages")
      .then((answer) => {
        if (!alive) return;
        setSearchPages(answer.pages.map((entry) => ({
          id: entry.id,
          title: entry.title,
          status: entry.status === "published" ? (entry.expired ? t("pages.status.expired") : t("pages.status.published")) : entry.status === "revoked" ? t("pages.status.revoked") : t("pages.status.draft"),
        })));
      })
      .catch(() => { if (alive) setSearchPages([]); });
    return () => { alive = false; };
  }, [searching, searchPages]);
  const catalogItems = useMemo<CatalogItem[]>(
    () => catalogSections(botSources.data ?? { organization: false, entries: [] }, botSources.templates, { category: "all", query: "", showArchived: true, app: null }).flatMap((section) => section.items),
    [botSources.data, botSources.templates],
  );
  const searchSources: SearchSource[] = [
    ...(githubHere ? [{ id: "github", name: t("myConnections.github.title") }] : []),
    ...(marketSummaries ?? []).map((market) => ({ id: `market:${market.name}`, name: market.name, detail: market.source })),
  ];
  const searchGroups = searching ? searchConnectApps({ query: search, items: scopedItems, catalog: catalogItems, pages: searchPages ?? [], sources: searchSources }) : [];
  const searchLoading = searching && (searchPages === null || mcp.servers === null || (!botSources.data && !botSources.loadFailed));
  const changeSearch = (value: string) => {
    setSearch(value);
    setActiveResult(-1);
    setOpenedGroups(new Set());
  };
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
  /** A result: its page, or its tab with it in view. The search empties. */
  const openResult = (result: SearchResult) => {
    changeSearch("");
    if (result.kind === "item") {
      const item = result.item;
      if (item.installed || item.kind === "plugin" || item.kind === "skill") {
        chooseTab(item.installed ? "installed" : "discover");
        openItem(item);
        return;
      }
      // not added yet: Discover, on its category, the row in view
      chooseTab("discover");
      setFilter(item.category);
      setType("any");
      revealLater(`[data-plugin-row="${CSS.escape(item.key)}"]`);
      return;
    }
    if (result.kind === "catalog") {
      chooseTab("bots");
      setBotFocus({ key: result.item.key, nonce: Date.now() });
      return;
    }
    if (result.kind === "page") {
      chooseTab("pages");
      revealLater(`[data-published-page="${CSS.escape(result.page.id)}"]`);
      return;
    }
    if (result.source.id === "github") {
      setTab("sources");
      openGithub();
      return;
    }
    chooseTab("sources");
    revealLater(`[data-marketplace="${CSS.escape(result.source.name)}"]`);
  };
  const searchRows = visibleResults(searchGroups, openedGroups);
  const searchField = (
    <ConnectAppsSearchField
      query={search}
      onQuery={changeSearch}
      groups={searchGroups}
      opened={openedGroups}
      active={activeResult < searchRows.length ? activeResult : -1}
      onActive={setActiveResult}
      onOpen={openResult}
    />
  );
  const searchResults = searching ? (
    <ConnectAppsSearchResults
        query={search}
        groups={searchGroups}
        opened={openedGroups}
        onOpenGroup={(id) => setOpenedGroups((current) => new Set([...current, id]))}
        active={activeResult < searchRows.length ? activeResult : -1}
        onActive={setActiveResult}
        onOpen={openResult}
        loading={searchLoading}
      />
  ) : undefined;

  const isOrgAdmin = perspicaxOrg?.viewerRole === "admin";
  const orgHere = isOrgAdmin && scope === "workspace" && perspicaxOrg !== null;
  // Sources: the GitHub connection row and the marketplaces (2026-10-29)
  const tabs: ConnectAppsTab[] = ["discover", "bots", "installed", "pages",
    ...(githubHere || marketRoute !== null || (marketSummaries?.length ?? 0) > 0 || orgHere ? ["sources" as const] : [])];
  const groups = connectorGroups({
    claude: harness.answer?.claude ? { available: harness.answer.claude.available, reason: harness.answer.claude.reason, connectors: harness.answer.claude.connectors ?? [], manageUrl: harness.answer.manageUrl } : null,
    claudeLoading: harness.loading && !harness.answer,
    grok: grokConfigured ? { connectors: GROK_CLOUD_CONNECTORS } : null,
    codex: harness.answer?.codex ?? null,
  });
  const content = (
    <ConnectAppsView
      tab={tab}
      onTab={chooseTab}
      page={subpage ?? undefined}
      tabs={tabs}
      // what "N connected" counted, on the tabs that list them (2026-10-28):
      // the person's connected entries on Installed, the engine accounts'
      // connectors on Providers (a bot's scope counts its plugins only)
      counts={connectedCounts({ entries, engineConnected: scope !== "workspace" ? 0 : claudeConnectors })}
      scope={scopeToggle}
      scopeNote={scopeControl}
      search={searchField}
      results={searchResults}
      notices={notices}
      refreshing={refreshing}
      onRefresh={refreshAll}
      installed={(
        <InstalledView
          loading={mcp.servers === null}
          entries={entries}
          resolved={scope === "bot" ? botCapabilities.data : undefined}
          resolvedError={scope === "bot" && !botCapabilities.data ? botCapabilities.error : null}
          onRetryResolved={() => void botCapabilities.reload()}
          botName={scopeBot?.name}
          organization={scope === "bot" && botCapabilities.data ? organizationRows(botCapabilities.data.items) : []}
          skills={scope === "bot" ? [] : privateSkills(items)}
          sourceLabel={pluginSourceLabel}
          onOpenEntry={(entry) => openItem(entry.primary)}
          onOpenSkill={openItem}
          entryActions={entryActions}
          onAddServer={scope === "workspace" && !mcp.restricted ? mcp.startAdd : undefined}
          onPasteConfig={scope === "workspace" && !mcp.restricted ? mcp.toggleImport : undefined}
          addDisabled={mcp.busy !== null}
          onNewSkill={scope !== "bot" && skillsOn && (scope === "me" || ownerOrAdmin !== false || libraryEditor) ? () => push({ page: "skill" }) : undefined}
          onDiscover={() => setTab("discover")}
          providers={(
        <AccountsView
          groups={groups}
          service={accountService}
          onService={setAccountService}
          refreshing={harness.loading}
          onRefresh={() => void harness.load(true)}
          servers={organization ? <MyMcpServers /> : undefined}
          claudeCode={!organization && canEditConfig(state.config) ? <ClaudeMcpSwitch /> : undefined}
          // a section with no account offers to connect it (2026-10-28):
          // Settings > Models and voice, where each engine signs in
          onSetUp={() => {
            close();
            openSettings(dispatch, "engines");
          }}
        />
      )}
          forms={scope === "workspace" ? (
            <>
              {mcp.restricted && mcp.policy && <p role="status" className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("policy.mcpRestricted", { organization: mcp.policy.organizationName })}</p>}
              <McpMessages mcp={mcp} />
              <McpReservedServers mcp={mcp} />
              <McpImportForm mcp={mcp} />
              {mcp.editing === "new" && <div className="mb-4"><McpServerEditor mcp={mcp} /></div>}
            </>
          ) : undefined}
        />
      )}
      discover={(
        <DiscoverView
          items={discoverItems(scopedItems, state.pluginsFocusApps ?? undefined)}
          loading={mcp.servers === null || (scope !== "workspace" && scopedPluginView === null)}
          filter={filter}
          onFilter={setFilter}
          type={type}
          onType={setType}
          sourceLabel={pluginSourceLabel}
          extraSources={(shownMarketplaces ?? []).map((market) => market.name)}
          focus={state.pluginsFocusApps ?? undefined}
          onOpenItem={openItem}
          renderAction={renderAction}
          renderBelow={renderBelow}
        />
      )}
      // Browse Bots (2026-10-29): its home, View all, a bot's page and the
      // templates' tools, under the tab's name
      bots={<BotCatalogPane onClose={close} backRef={botsBack} tabLabel={connectAppsTabLabel("bots")} sources={botSources} focus={botFocus} />}
      pages={<PublishedPagesSettings personal />}
      sources={(
        <SourcesView
          onOpenGithub={githubHere ? openGithub : undefined}
          githubSummary={githubHere && organization ? <MyGithubSummary /> : undefined}
          marketplaces={marketRoute !== null || (marketSummaries?.length ?? 0) > 0 ? (
            <MarketplacesSection
              marketplaces={marketSummaries}
              busy={marketBusy}
              error={marketError}
              onAdd={addMarketplace}
              onRefresh={refreshMarketplace}
              onRemove={removeMarketplace}
              onSetVisibility={marketRoute === "workspace" ? setMarketplaceVisibility : undefined}
              canChooseVisibility={marketRoute !== null}
              disabled={marketRoute === null}
              removeKeepsInstalls={marketRoute === "bot" || marketRoute === "me"}
              credentials={marketCredentials}
              needsToken={marketCredentials ? marketNeedsToken : null}
              onOpenGithub={githubHere ? openGithub : undefined}
            />
          ) : undefined}
          organization={orgHere ? <OrgSourcesAccess initial={perspicaxOrg.settings} flat /> : undefined}
        />
      )}
    />
  );

  return (
    <div
      className={CATEGORY_MODAL.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      {/* Browse Bots' window (src/components/category-modal.ts): same size,
          frame and close button, so the two read as one window. */}
      <div
        ref={dialogRef}
        data-tour="apps-panel"
        data-plugins-page={page.page}
        data-plugins-depth={stack.length - 1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugins-title"
        tabIndex={-1}
        className={cn("animate-pop-in", CATEGORY_MODAL.frame)}
      >
        <div className={CATEGORY_MODAL.content}>
          <button
            type="button"
            data-tour="apps-close"
            onClick={close}
            aria-label={t("connectors.closeAria")}
            className={CATEGORY_MODAL.close}
          >
            <X size={18} />
          </button>
          {content}
        </div>
      </div>
      {dataCenterFor && (
        <DataCenterDialog
          name={dataCenterFor.item.name}
          regions={dataCenterFor.regions}
          defaultUrl={dataCenterFor.defaultUrl}
          onCancel={() => setDataCenterFor(null)}
          onChoose={(region) => {
            const { item } = dataCenterFor;
            setDataCenterFor(null);
            void installFeatured(item, region);
          }}
        />
      )}
    </div>
  );
}

interface DetailContext {
  mcp: ReturnType<typeof useMcpServers>;
  /** the GitHub plugin's page, for a server that reads the GitHub account */
  openGithub: () => void;
  /** the GitHub plugin's key: its page shows the GitHub connection */
  githubKey: string | null;
  /** the GitHub connection (GithubAccountSection), where it is in reach */
  githubSection: ReactNode;
  /** "+ Add another account" on an MCP server: the name being typed */
  mcpAccountDraft: { server: string; label: string } | null;
  setMcpAccountDraft: (value: { server: string; label: string } | null) => void;
  items: PluginItem[];
  marketplaces: MarketplaceListing[] | null;
  installing: string | null;
  openItem: (item: PluginItem) => void;
  uninstallPlugin: (item: PluginItem) => void;
  scope: PluginScope;
  /** the plugin "For <bot>" (absent: no bot in reach) */
  botCard: ReactNode;
  updatePlugin: (item: PluginItem) => void;
}

type DetailBase = Omit<PluginDetailProps, "onBack" | "onClose">;

function detailProps(item: PluginItem, context: DetailContext): DetailBase {
  if (isGrokConnector(item)) return grokConnectorDetail(item);
  if (item.kind === "plugin") {
    const marketplace = item.id.split("@")[1];
    const source = context.marketplaces?.find((entry) => entry.name === marketplace)?.source;
    return { ...pluginDetail(item, context), link: pluginShareLink({ kind: "plugin", marketplaceSource: source }) };
  }
  const server = context.mcp.servers?.find((candidate) => candidate.name === item.id);
  return { ...mcpDetail(item, context), link: pluginShareLink({ kind: "mcp", serverUrl: server && "url" in server ? server.url : undefined }) };
}

function mcpDetail(item: PluginItem, { mcp, mcpAccountDraft, setMcpAccountDraft, openGithub }: DetailContext): DetailBase {
  const server = mcp.servers?.find((entry) => entry.name === item.id);
  if (!server) return { item, subtitle: "", busy: true, details: [] };
  const name = server.name;
  const remote = isRemoteMcpListing(server);
  const disabled = new Set(server.disabledTools ?? []);
  const probe = mcp.probe[name];
  // A tool Grok registers under another name, or cannot register, says so
  // on its row: a connector tool is never lost without a word.
  const grokNames = probe?.ok ? probe.engineNames?.grok : undefined;
  const engineNote = (tool: string) => {
    const renamed = grokNames?.renamed.find((entry) => entry.upstream === tool);
    if (renamed) return t("mcp.engineName.renamed", { name: renamed.registered });
    const failed = grokNames?.unregistrable.find((entry) => entry.upstream === tool);
    return failed ? t("mcp.engineName.unregistrable", { reason: failed.reason }) : undefined;
  };
  const toolList = probe?.ok ? (probe.tools ?? []).map((tool) => {
    const note = engineNote(tool.name);
    return { name: tool.name, description: note ? [note, tool.description].filter(Boolean).join(" ") : tool.description, enabled: !disabled.has(tool.name) };
  }) : null;
  const signingIn = mcp.busy === `oauth:${name}` || Boolean(mcp.waiting[name]);
  const issuer = remote ? (server.authIssuer ?? safeHost(server.url)) : "";
  const others = remote ? (server.accounts ?? []).filter((entry) => entry.id !== "default") : [];
  // An account the person names, after the first one (MAX_MCP_ACCOUNTS).
  const canAddAccount = remote && server.auth === "connected" && !server.managedBy && others.length < 9;
  let account: DetailAccount;
  let accountAction: ReactNode = null;
  if (server.github) {
    // the GitHub plugin's server reads the person's GitHub account: its
    // account is that one, connected on the GitHub plugin's page
    account = {
      id: "github", label: t("connectApps.detail.githubAccount"),
      detail: server.github === "connected" ? t("connectApps.detail.githubConnected") : t("connectApps.detail.githubMissing"),
      status: server.github === "connected" ? "connected" : "needs_auth",
    };
    accountAction = <button type="button" className="ui-button text-[12px]" data-mcp-open-github onClick={openGithub}>{t("connectApps.detail.openGithub")}</button>;
  } else if (remote && server.auth === "connected") {
    account = {
      id: "oauth", label: others.length ? t("mcp.accounts.first", { issuer }) : issuer, detail: t("connectApps.detail.signedIn"), status: "connected",
      onRemove: () => void mcp.signOut(server), removeLabel: t("mcp.oauth.disconnectAria", { name }),
    };
    accountAction = canAddAccount && mcpAccountDraft?.server !== name
      ? <AddAccountButton label={t("connectApps.detail.addAccount")} disabled={mcp.busy !== null} onClick={() => setMcpAccountDraft({ server: name, label: "" })} />
      : null;
  } else if (remote && (server.auth === "required" || server.auth === "expired" || server.auth === "error")) {
    account = { id: "oauth", label: issuer, detail: server.authError, status: "needs_auth" };
    accountAction = <SignInButton label={t(server.auth === "expired" ? "mcp.oauth.signInAgain" : "mcp.oauth.signIn")} busy={signingIn} disabled={mcp.busy !== null || Boolean(server.managedBy)} onClick={() => void mcp.signIn(server)} />;
  } else {
    const keys = remote ? server.headerKeys : server.envKeys;
    account = {
      id: "default",
      label: t("connectApps.detail.defaultAccount"),
      detail: keys.length ? t(remote ? "mcp.headersSaved" : "mcp.secretsSaved", { keys: keys.join(", ") }) : t("connectApps.detail.noSignIn"),
      status: server.enabled ? "connected" : "off",
    };
  }
  const oauthError = mcp.oauthError[name];
  const count = toolList ? t("connectApps.detail.toolsEnabled", { enabled: toolList.filter((tool) => tool.enabled).length, total: toolList.length })
    : disabled.size ? t("connectApps.detail.toolsOff", { count: disabled.size }) : t("connectApps.detail.toolsAll");
  return {
    item,
    subtitle: remote ? server.url : [server.command, ...server.args].join(" "),
    busy: mcp.busy !== null,
    onUninstall: () => void mcp.remove(server),
    onEdit: () => mcp.startEdit(server),
    onTest: () => void mcp.test(server),
    testing: mcp.busy === `test:${name}`,
    enabled: { value: server.enabled, onToggle: () => void mcp.toggle(server), label: t("mcp.toggleAria", { name, state: t(server.enabled ? "mcp.state.off" : "mcp.state.on") }) },
    accounts: [account, ...others.map((other, index): DetailAccount => {
      const label = readableOr(other.label ?? other.id, t("ids.accountN", { n: index + 2 }));
      return {
        id: other.id,
        label,
        detail: other.auth === "connected" ? t("connectApps.detail.signedIn") : other.authError ?? t("mcp.accounts.notSignedIn"),
        status: other.auth === "connected" ? "connected" : other.authPending ? "pending" : "needs_auth",
        action: other.auth === "connected" ? undefined : (
          <button type="button" disabled={mcp.busy !== null} onClick={() => void mcp.signIn(server, { id: other.id })} className="ui-button text-[12px] disabled:opacity-40">
            {t("mcp.oauth.signInAgain")}
          </button>
        ),
        onRemove: () => {
          if (!window.confirm(t("mcp.accounts.removeConfirm", { account: label, name }))) return;
          void mcp.signOut(server, other.id);
        },
        removeLabel: t("mcp.accounts.removeAria", { account: label, name }),
      };
    })],
    accountAction,
    accountExtra: (
      <>
        {mcpAccountDraft?.server === name && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const label = mcpAccountDraft.label.trim();
              if (!label) return;
              void mcp.signIn(server, { label }).then(() => setMcpAccountDraft(null));
            }}
          >
            <input
              autoFocus
              value={mcpAccountDraft.label}
              maxLength={60}
              onChange={(event) => setMcpAccountDraft({ server: name, label: event.target.value })}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMcpAccountDraft(null); } }}
              placeholder={t("mcp.accounts.labelPlaceholder")}
              aria-label={t("mcp.accounts.labelAria", { name })}
              className="min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none"
            />
            <button type="submit" disabled={mcp.busy !== null || !mcpAccountDraft.label.trim()} className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink disabled:opacity-40">
              {t("mcp.oauth.signIn")}
            </button>
            <button type="button" onClick={() => setMcpAccountDraft(null)} className="ui-button text-[12px]">{t("common.cancel")}</button>
          </form>
        )}
        {remote && server.auth && server.auth !== "none" && server.auth !== "connected" && <McpAuthLine server={server} />}
        {mcp.waiting[name] && (
          <div role="status" className="mt-2 flex items-center gap-2 rounded-lg bg-raised/60 px-3 py-2 text-[12px] text-ink-secondary">
            <Loader2 size={13} className="shrink-0 animate-spin" /> {t("mcp.oauth.waiting")}
          </div>
        )}
        {mcp.clientDraft[name] && (
          <McpClientForm
            draft={mcp.clientDraft[name]!}
            disabled={mcp.busy !== null}
            onChange={(next) => mcp.setClientDraft((current) => ({ ...current, [name]: next }))}
            onCancel={() => mcp.forgetClientDraft(name)}
            onSubmit={() => void mcp.signIn(server)}
          />
        )}
        {oauthError && (
          <div role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {typeof oauthError === "string" ? oauthError : t(oauthError.key, oauthError.params)}
          </div>
        )}
        {server.managedBy && <p className="mt-2 text-[11.5px] text-ink-secondary">{t("policy.mcpBlocked", { organization: server.managedBy })}</p>}
      </>
    ),
    tools: {
      list: toolList,
      loading: mcp.busy === `test:${name}`,
      error: probe && !probe.ok ? probe.error : undefined,
      note: t("connectApps.detail.toolsNote"),
      onToggle: (tool, enabled) => {
        const next = new Set(disabled);
        if (enabled) next.delete(tool);
        else next.add(tool);
        void mcp.setDisabledTools(server, [...next].sort());
      },
      onLoad: () => void mcp.test(server),
    },
    details: [
      { label: t("connectApps.detail.source"), value: pluginSourceLabel(item.source) },
      { label: t("connectApps.detail.transport"), value: remote ? (server.type === "sse" ? "SSE" : "HTTP") : "stdio" },
      { label: remote ? t("connectApps.detail.url") : t("connectApps.detail.command"), value: remote ? server.url : [server.command, ...server.args].join(" "), mono: true },
      { label: t("connectApps.detail.tools"), value: count },
    ],
    children: (
      <>
        {remote && isWhopServer(server) && <p className="rounded-2xl border border-border bg-card px-4 py-3 text-[12px] leading-relaxed text-ink-secondary sm:px-5">{t("whop.notice")}</p>}
        <McpMessages mcp={mcp} />
        {mcp.editing === name && <McpServerEditor mcp={mcp} />}
      </>
    ),
  };
}

/** A marketplace plugin: what it brought, each one a link to its own page. */
function pluginDetail(item: PluginItem, { items, marketplaces, installing, openItem, uninstallPlugin, updatePlugin, scope, botCard, openGithub, githubKey, githubSection }: DetailContext): DetailBase {
  const [plugin, marketplace] = item.id.split("@") as [string, string];
  const market = marketplaces?.find((entry) => entry.name === marketplace);
  const entry = market?.plugins.find((candidate) => candidate.name === plugin);
  const children = items.filter((candidate) => candidate.parent === item.key);
  // the GitHub plugin's page holds the GitHub connection, first (2026-10-29)
  const github = item.key === githubKey && githubSection ? githubSection : null;
  const installedVersion = item.installedVersion ?? item.version;
  const subtitle = `${market?.source ?? marketplace}${installedVersion ? ` · ${installedVersion}` : ""}`;
  const versionDetails = [
    ...(installedVersion ? [{ label: t("connectApps.detail.version"), value: installedVersion }] : []),
    ...(item.updateAvailable ? [{
      label: t("connectApps.plugin.available"),
      value: item.installedVersion && item.version ? item.version : t("connectApps.plugin.newerFiles"),
    }] : []),
  ];
  // The technical id and the repository: secondary, in Details (the header
  // shows the name people read).
  const sourceDetails = [
    { label: t("connectApps.detail.id"), value: item.id, mono: true },
    ...(market?.source && market.source !== marketplace ? [{ label: t("connectApps.detail.repository"), value: market.source, mono: true }] : []),
  ];
  // For a bot the page is that bot's install: the card says what it brings,
  // and its Update installs the marketplace's files again in place.
  if (scope !== "workspace") {
    return {
      item,
      subtitle,
      busy: installing !== null,
      details: [
        { label: t("connectApps.detail.source"), value: marketplace },
        ...sourceDetails,
        ...versionDetails,
      ],
      children: (
        <>
          {item.description && <p className="px-1 text-[12.5px] leading-relaxed text-ink-secondary">{item.description}</p>}
          {github}
          {botCard}
        </>
      ),
    };
  }
  return {
    item,
    subtitle,
    busy: installing !== null,
    onUninstall: () => uninstallPlugin(item),
    ...(item.installed && item.updateAvailable ? { onUpdate: () => updatePlugin(item), updating: installing === item.id } : {}),
    details: [
      { label: t("connectApps.detail.source"), value: marketplace },
      ...sourceDetails,
      ...versionDetails,
      { label: t("connectApps.plugin.connectors"), value: String(entry?.servers.length ?? 0) },
      { label: t("connectApps.filter.skills"), value: String(entry?.skills.length ?? 0) },
    ],
    children: (
      <>
        {github}
        {botCard}
        <section className="rounded-2xl border border-border bg-card px-4 py-3.5 sm:px-5">
          <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.plugin.brings")}</h3>
          {item.description && <p className="mb-2 text-[12.5px] leading-relaxed text-ink-secondary">{item.description}</p>}
          {children.length === 0 ? (
            <p className="text-[12px] text-ink-secondary">{t("connectApps.plugin.bringsNothing")}</p>
          ) : (
            <ul className="divide-y divide-hairline/60">
              {children.map((child) => (
                <li key={child.key}>
                  <button type="button" onClick={() => openItem(child)} className="flex w-full items-center gap-3 py-2 text-left hover:text-ink">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{child.name}</span>
                      <span className="block truncate text-[11px] text-ink-secondary">{child.kind === "skill" ? t("connectApps.filter.skills") : t("connectApps.filter.mcp")}</span>
                    </span>
                    <PluginStatusLabel status={child.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!github && children.some((child) => child.githubAccount) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-inset px-3 py-2" data-plugin-github-account={children.some((child) => child.githubAccount === "missing") ? "missing" : "connected"}>
              <span className="min-w-0 flex-1 text-[12px] text-ink-secondary">
                {children.some((child) => child.githubAccount === "missing") ? t("connectApps.detail.githubMissing") : t("connectApps.detail.githubConnected")}
              </span>
              <button type="button" className="ui-button text-[12px]" onClick={openGithub}>{t("connectApps.detail.openGithub")}</button>
            </div>
          )}
          <p className="mt-2 text-[11.5px] text-ink-secondary">{t("connectApps.plugin.note")}</p>
        </section>
      </>
    ),
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
