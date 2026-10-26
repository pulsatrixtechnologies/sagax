// Plugins: one panel in three views, after the "Connect apps" screens people
// know from desktop assistants.
//
//   - Connect apps (main): every connected app, MCP server, catalog plugin
//     and skill in one list (one row per app, whatever its sources), with
//     search across all of them, category chips, a small type filter and a
//     section per category. "N connected" opens Manage.
//   - Manage: installed plugins, private skills (each opens its skill page),
//     a person's own connections on an organization server, and in Advanced:
//     Add manually / Paste config, marketplaces, the settings for every
//     MCP server.
//   - Detail: one plugin's accounts, tools (a switch per MCP tool, applied to
//     every bot) and details, with Uninstall.
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
import { readableOr } from "../../shared/human-id";
import { isWhopServer } from "@/lib/whop-integration";
import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { viewerCan } from "@/lib/viewer";
import { permissionMissingText } from "@/lib/permissions";
import type { SkillsLibrarySkillWire } from "../../shared/wire";
import { WHOP_KEY, buildPluginItems, isGrokConnector, marketplacePluginKey, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import { GROK_CLOUD_CONNECTORS, GROK_CONNECTORS_URL } from "../../shared/grok-cloud-connectors";
import { grokProviderConfigured } from "@/lib/providers-model";
import { openExternalLink } from "@/lib/app-links";
import {
  addMarketplace as addBotMarketplace,
  installPlugin as installBotPlugin,
  loadBotPlugins,
  MARKETPLACE_ACCESS_CODES,
  removeMarketplace as removeBotMarketplace,
  removeMarketplaceToken as removeBotMarketplaceToken,
  setMarketplaceToken as setBotMarketplaceToken,
  setPluginConfig as setBotPluginConfig,
  setPluginEnabled as setBotPluginEnabled,
  uninstallPlugin as uninstallBotPlugin,
  updateMarketplace as updateBotMarketplace,
  type BotPluginsView,
  type MarketplaceVisibility,
} from "@/lib/my-connections";
import { botPluginState, botScopeMarketplaces, initialPluginScope, marketplaceRoute, pluginScopeBot, workspaceMarketplaceTokens, type PluginScope } from "@/lib/plugin-scope";
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
import { IntegrationsManagedNotice, MyConnectionsSettings } from "./settings/MyConnectionsSettings";
import { useServerMode } from "./ServerModeSettings";
import { ProvidersSection } from "./plugins/ProvidersSection";
import { ConnectAppsView, sectionTitle } from "./plugins/ConnectAppsView";
import type { Crumb } from "./Breadcrumb";
import { CATEGORY_MODAL, cardActionClass } from "./category-modal";
import { BotCatalogPane } from "./lazy-screens";
import { isBackShortcut, pageKeyAction } from "@/lib/back-shortcut";
import { ManageView } from "./plugins/ManageView";
import { MarketplacesSection } from "./plugins/MarketplacesSection";
import { OrgSourcesAccess, showOrgSourcesAccess } from "./plugins/OrgSourcesAccess";
import { PluginStatusLabel } from "./plugins/PluginParts";
import { pluginShareLink } from "@/lib/plugin-link";
import { DataCenterDialog, type DataCenter } from "./plugins/DataCenterDialog";
import { AddAccountButton, PluginDetailView, SignInButton, type DetailAccount, type PluginDetailProps } from "./plugins/PluginDetailView";
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
 * breadcrumb): Connect apps at the bottom, then what was opened from it. */
type Page =
  | { page: "main" }
  /** View all on a section: that section alone */
  | { page: "section"; id: string; filter?: PluginFilter; type?: PluginTypeFilter }
  | { page: "manage" }
  | { page: "detail"; key: string }
  /** a private skill's page; no name: a new skill */
  | { page: "skill"; name?: string }
  /** Browse Bots, in this same window (2026-10-16) */
  | { page: "bots" };

/** Connectors a Claude account brings to bots (Manage > Providers lists
 * them); "N connected" counts the connected ones. */
function useClaudeConnectorCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api("/api/me/harness-connectors", { timeoutMs: 90_000 })
      .then((answer) => {
        const connectors: Array<{ status?: string }> = answer?.claude?.available ? answer.claude.connectors ?? [] : [];
        if (!cancelled) setCount(connectors.filter((connector) => connector.status === "connected").length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [type, setType] = useState<PluginTypeFilter>(state.pluginsSurface === "mcp" ? "mcp" : "any");
  const claudeConnectors = useClaudeConnectorCount();
  const ownerOrAdmin = useOwnerOrAdmin();
  // 2026-10-09: a profile with skills.library changes the library too.
  const libraryEditor = ownerOrAdmin === true || (ownerOrAdmin === false && viewerCan(state.config, "skills.library"));
  const serverMode = useServerMode();
  const perspicaxOrg = usePerspicaxOrg();
  const organization = Boolean(serverMode?.active) || perspicaxOrg !== null;
  // Organization sources and access: an organization admin only (the server
  // answers 403 to anyone else).
  const orgAdmin = perspicaxOrg?.viewerRole === "admin";
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
  const scope: PluginScope = scopeChoice === "bot" && scopeBot ? "bot" : "workspace";
  const [botView, setBotView] = useState<BotPluginsView | null>(null);
  const [botBusy, setBotBusy] = useState<string | null>(null);

  const loadFeatured = useCallback(() => api("/api/plugins/search")
    .then((result) => setFeatured(result.featured ?? []))
    .catch(() => setFeatured([])), []);
  const loadSkills = useCallback(() => api("/api/skills-library")
    .then((result) => setSkills(result.skills ?? []))
    // the skills library is an option: off, there are no private skills
    .catch(() => setSkills([])), []);
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
      setBotView(await loadBotPlugins(scopeBotId));
    } catch {
      setBotView(null);
    }
  }, [scopeBotId]);
  useEffect(() => {
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
  }, [loadFeatured, loadSkills, loadMarketplaces]);
  useEffect(() => {
    void loadBotView();
  }, [loadBotView]);

  const close = useCallback(() => dispatch({ type: "togglePlugins", open: false }), [dispatch]);
  // A link to Organization sources and access (the old Settings >
  // Organization > Plugins and GitHub card): Manage, for everyone, with
  // Advanced open at that section.
  const orgAccessRequested = state.pluginsPage === "orgAccess";
  useEffect(() => {
    if (!orgAccessRequested) return;
    setScopeChoice("workspace");
    setStack([{ page: "main" }, { page: "manage" }]);
  }, [orgAccessRequested]);
  useEffect(() => {
    if (!orgAccessRequested || !orgAdmin || page.page !== "manage") return;
    let frames = 0;
    const reveal = () => {
      const section = dialogRef.current?.querySelector<HTMLElement>("[data-plugins-org-access]");
      if (section) section.scrollIntoView?.({ block: "start" });
      else if (++frames < 30) requestAnimationFrame(reveal);
    };
    requestAnimationFrame(reveal);
  }, [orgAccessRequested, orgAdmin, page.page]);
  const skillsLibraryOn = skillsLibraryEnabled(state.config);
  const back = useCallback(() => setStack((current) => current.length > 1 ? current.slice(0, -1) : current), []);
  useEffect(() => { void BotCatalogPane.preload().catch(() => undefined); }, []);

  // Focus and keys: Escape steps back one page (Browse Bots' own steps
  // first), then closes; Cmd+[ steps back and never closes.
  const pageRef = useRef(page);
  pageRef.current = page;
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
        const action = pageKeyAction(event, { depth: depthRef.current, innerBack: pageRef.current.page === "bots" ? () => botsBack.current?.() ?? false : undefined });
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
    () => (scope === "bot" ? (botView ? botScopeMarketplaces(botView) : null) : marketplaces),
    [scope, botView, marketplaces],
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
  const scopedItems = useMemo(() => (scope === "bot" ? items.filter((item) => item.kind === "plugin") : items), [scope, items]);

  const refreshAll = () => {
    void mcp.load(true);
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
    void loadBotView();
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
      setPanelError(cause instanceof Error ? cause.message : String(cause));
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
      setMarketError(cause instanceof Error ? cause.message : String(cause));
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
  const marketRoute = marketplaceRoute({ workspaceManager: workspaceMarkets, scope, botView });
  const afterBotMarket = async (view: BotPluginsView) => {
    setBotView(view);
    if (workspaceMarkets) await loadMarketplaces();
  };
  const addMarketplace = (source: string, ref: string, visibility: MarketplaceVisibility, token?: string) => marketAction("add", async () => {
    if (marketRoute === "bot" && scopeBotId) {
      await afterBotMarket(await addBotMarketplace(scopeBotId, source, { ...(ref ? { ref } : {}), ...(token ? { token } : {}), visibility }));
      return;
    }
    const result = await api("/api/marketplaces", { method: "POST", body: JSON.stringify({ source, ...(ref ? { ref } : {}), ...(token ? { token } : {}), visibility }) });
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
    if (marketRoute === "bot" && scopeBotId) {
      await afterBotMarket(await updateBotMarketplace(scopeBotId, name));
      return;
    }
    const result = await api(`/api/marketplaces/${encodeURIComponent(name)}/refresh`, { method: "POST", body: "{}" });
    setMarketplaces(result.marketplaces ?? []);
    void loadBotView();
  });
  const removeMarketplace = (name: string) => {
    const fromBot = marketRoute === "bot" && scopeBot;
    if (!window.confirm(fromBot ? t("connectApps.market.removeFromBotConfirm", { name, bot: scopeBot.name }) : t("connectApps.market.removeConfirm", { name }))) return;
    void marketAction(`remove:${name}`, async () => {
      if (fromBot) {
        const view = await removeBotMarketplace(scopeBot.id, name);
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
  /** That bot's token for a marketplace (server/marketplace-tokens.ts):
   * saved, then the marketplace is fetched again with it. In the Everyone
   * scope, an admin keeps one token per marketplace for the whole
   * installation (never shown back), so a private marketplace works for
   * everyone. */
  const marketTokens = marketRoute === "bot" && scopeBotId ? {
    scope: "bot" as const,
    onSave: (name: string, token: string) => marketAction(`refresh:${name}`, async () => {
      await setBotMarketplaceToken(scopeBotId, name, token);
      await afterBotMarket(await updateBotMarketplace(scopeBotId, name));
    }),
    onRemove: (name: string) => marketAction(`token:${name}`, async () => {
      await afterBotMarket(await removeBotMarketplaceToken(scopeBotId, name));
    }),
  } : marketRoute === "workspace" && ownerOrAdmin === true ? workspaceMarketplaceTokens<MarketplaceListing>({
    api,
    run: marketAction,
    loaded: (list) => { setMarketplaces(list); void loadBotView(); },
  }) : undefined;
  const marketSummaries = marketRoute === "bot" && botView
    ? botScopeMarketplaces(botView)
    : marketRoute === "workspace" ? marketplaces : null;

  /** "For <bot>": the whole plugin on that one bot. */
  const botAction = async (busy: string, work: () => Promise<BotPluginsView>): Promise<void> => {
    setBotBusy(busy);
    setPanelError(null);
    try {
      setBotView(await work());
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBotBusy(null);
    }
  };
  const installForBot = (id: string) => {
    const at = id.lastIndexOf("@");
    if (!scopeBotId || at <= 0) return;
    void botAction(`install:${id}`, () => installBotPlugin(scopeBotId, id.slice(at + 1), id.slice(0, at)));
  };
  const uninstallForBot = (id: string) => {
    if (!scopeBot || !window.confirm(t("connectApps.botPlugin.uninstallConfirm", { name: id.slice(0, id.lastIndexOf("@")), bot: scopeBot.name }))) return;
    void botAction(`remove:${id}`, () => uninstallBotPlugin(scopeBot.id, id));
  };
  const toggleForBot = (id: string, enabled: boolean) => {
    if (!scopeBotId) return;
    void botAction(`toggle:${id}`, () => setBotPluginEnabled(scopeBotId, id, enabled));
  };
  const botCard = (item: PluginItem): ReactNode => {
    if (!scopeBot || !botView || item.kind !== "plugin") return null;
    const plugin = botPluginState(botView, item.id);
    if (!plugin) return null;
    const busy = botBusy?.endsWith(`:${item.id}`) ? botBusy.slice(0, botBusy.indexOf(":")) : botBusy ? "other" : null;
    return (
      <BotPluginCard
        botName={scopeBot.name}
        view={botView}
        plugin={plugin}
        busy={busy}
        onInstall={() => installForBot(item.id)}
        onToggle={(enabled) => toggleForBot(item.id, enabled)}
        onUninstall={() => uninstallForBot(item.id)}
        onSaveConfig={async (values) => {
          if (!scopeBotId) return;
          setBotView(await setBotPluginConfig(scopeBotId, item.id, values));
        }}
      />
    );
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
      setPanelError(cause instanceof Error ? cause.message : String(cause));
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
      setPanelError(cause instanceof Error ? cause.message : String(cause));
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
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(null);
    }
  };

  const renderAction = (item: PluginItem) => {
    const grokAction = grokRowAction(item);
    if (grokAction !== undefined) return grokAction;
    if (item.key === WHOP_KEY) return <WhopAction mcp={mcp} />;
    if (item.kind === "plugin") {
      if (scope === "bot") {
        // installed on this bot: Install again updates it in place (its
        // switch and install date stay, server/bot-plugins.ts)
        if (!botView?.canChange || (item.installed && !item.updateAvailable)) return null;
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

  const scopeControl = scopeBot ? (
    <div data-plugins-scope-bar>
      <ScopeToggle scope={scope} botName={scopeBot.name} onScope={setScopeChoice} />
      {scope === "bot" && (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
          {t("connectApps.scope.botNote", { name: scopeBot.name })}
          {botView && !botView.canChange && !botView.managedByAdmin && <> {t("plugins.readOnly")}</>}
        </p>
      )}
      {scope === "bot" && botView?.managedByAdmin && <div className="mt-2"><IntegrationsManagedNotice /></div>}
      {scope === "bot" && botView && botView.marketplaces.length === 0 && (
        <p className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary" data-plugins-scope-empty>{t("connectApps.scope.noMarketplaces")}</p>
      )}
    </div>
  ) : null;

  const detailItem = page.page === "detail" ? items.find((item) => item.key === page.key) : undefined;
  // The breadcrumb: each page under the current one, Connect apps first.
  const pageLabel = (entry: Page): string => {
    switch (entry.page) {
      case "main": return t("connectApps.title");
      case "section": return sectionTitle({ id: entry.id }, pluginSourceLabel);
      case "manage": return t("connectApps.manage.title");
      case "detail": return items.find((item) => item.key === entry.key)?.name ?? t("connectApps.back");
      case "skill": return entry.name ?? t("connectApps.skill.new");
      case "bots": return t("botCatalog.title");
    }
  };
  const trail: Crumb[] = stack.slice(0, -1).map((entry, depth) => ({ label: pageLabel(entry), onSelect: () => popTo(depth) }));
  // An item that went away (uninstalled, or removed elsewhere) leaves its page.
  const detailMissing = page.page === "detail" && !detailItem && mcp.servers !== null && skills !== null && shownMarketplaces !== null;
  // A skill deleted or renamed elsewhere leaves its page too.
  const skillMissing = page.page === "skill" && Boolean(page.name) && skills !== null && !skills.some((entry) => entry.name === page.name);
  useEffect(() => {
    if (detailMissing || skillMissing) back();
  }, [detailMissing, skillMissing, back]);

  const skillsOn = skills !== null && skillsLibraryOn;
  const pageSkill = page.page === "skill" && page.name ? skills?.find((entry) => entry.name === page.name) : undefined;
  const skillReadOnly = (skill: SkillsLibrarySkillWire): string | undefined => {
    if (ownerOrAdmin === false && !libraryEditor) return perspicaxOrg !== null ? permissionMissingText("skills.library") : t("connectApps.skill.readOnlyOwner");
    if (skill.version) return t("connectApps.skill.readOnlyOrganization");
    const plugin = marketplaces?.find((market) => market.name === skill.source)?.plugins.find((entry) => entry.installed && entry.skills.includes(skill.name));
    if (plugin) return t("connectApps.skill.readOnlyPlugin", { plugin: plugin.name });
    return undefined;
  };

  let content;
  if (page.page === "skill" && (pageSkill || !page.name)) {
    content = (
      <SkillPage
        key={page.name ?? "new"}
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
  } else if (page.page === "manage") {
    content = (
      <ManageView
        items={scopedItems}
        countLabel={(item) => (scope === "bot" ? botCountLabel(item, botView) : countLabel(item, marketplaces))}
        sourceLabel={pluginSourceLabel}
        scope={scopeControl}
        pluginsOnly={scope === "bot"}
        onBack={back}
        trail={trail}
        onOpenItem={openItem}
        onNewSkill={skillsOn && (ownerOrAdmin !== false || libraryEditor) ? () => push({ page: "skill" }) : undefined}
        personal={organization ? (
          <section className="mt-6" data-plugins-personal>
            <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.personal")}</h3>
            <MyConnectionsSettings />
          </section>
        ) : undefined}
        advancedOpen={mcp.editing === "new" || mcp.importOpen || orgAccessRequested}
        onAddManually={mcp.startAdd}
        onPasteConfig={mcp.toggleImport}
        addDisabled={mcp.busy !== null || mcp.restricted}
        addTitle={mcp.restricted && mcp.policy ? t("policy.managedBy", { organization: mcp.policy.organizationName }) : undefined}
        refreshing={refreshing}
        onRefresh={refreshAll}
        providers={<ProvidersSection instances={state.instances} />}
        forms={(
          <>
            {mcp.restricted && mcp.policy && <p role="status" className="mt-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("policy.mcpRestricted", { organization: mcp.policy.organizationName })}</p>}
            <McpMessages mcp={mcp} />
            <McpReservedServers mcp={mcp} />
            <McpImportForm mcp={mcp} />
            {mcp.editing === "new" && <McpServerEditor mcp={mcp} />}
          </>
        )}
      >
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
          removeKeepsInstalls={marketRoute === "bot"}
          tokens={marketTokens}
          needsToken={marketTokens ? marketNeedsToken : null}
        />
        {perspicaxOrg && showOrgSourcesAccess(perspicaxOrg, scope) && <OrgSourcesAccess initial={perspicaxOrg.settings} />}
        {scope === "workspace" && (
          <section className="mt-6">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.settings")}</h3>
            <ClaudeMcpSwitch />
          </section>
        )}
      </ManageView>
    );
  } else if (page.page === "detail" && detailItem) {
    content = (
      <PluginDetailView
        {...detailProps(detailItem, { mcp, mcpAccountDraft, setMcpAccountDraft,
          items, marketplaces: shownMarketplaces, installing, openItem, uninstallPlugin: (item) => void uninstallPlugin(item), updatePlugin: (item) => void updatePlugin(item),
          scope, botCard: botCard(detailItem) })}
        onBack={back}
        trail={trail}
      />
    );
  } else if (page.page === "bots") {
    content = <BotCatalogPane onClose={close} backRef={botsBack} trail={trail} />;
  } else if (page.page === "detail" || page.page === "skill") {
    content = (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary">
        <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
      </div>
    );
  } else {
    content = (
      <ConnectAppsView
        items={scopedItems}
        scope={scopeControl}
        loading={mcp.servers === null || (scope === "bot" && botView === null)}
        search={search}
        onSearch={setSearch}
        filter={page.page === "section" ? page.filter ?? "all" : filter}
        onFilter={setFilter}
        type={page.page === "section" ? page.type ?? "any" : type}
        onType={(next) => {
          setType(next);
          if (next === "mcp" || next === "apps" || next === "any") {
            dispatch({ type: "togglePlugins", open: true, surface: next === "mcp" ? "mcp" : "apps" });
          }
        }}
        sourceLabel={pluginSourceLabel}
        extraSources={(shownMarketplaces ?? []).map((market) => market.name)}
        extraConnected={scope === "bot" ? 0 : claudeConnectors}
        onOpenManage={() => push({ page: "manage" })}
        onBrowseBots={remoteClient ? undefined : () => push({ page: "bots" })}
        onViewAll={(section) => {
          if (!section.filter) return;
          push({ page: "section", id: section.id, ...section.filter });
        }}
        subpage={page.page === "section" ? { title: pageLabel(page), trail, onBack: back } : undefined}
        onOpenItem={openItem}
        renderAction={renderAction}
        renderBelow={renderBelow}
        notices={notices}
        focus={state.pluginsFocusApps ?? undefined}
      />
    );
  }

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
        aria-labelledby={page.page === "bots" ? "bot-catalog-title" : "plugins-title"}
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

/** Installed card subline, as the reference: how many connectors it brings
 * (an app or a server is one; a marketplace plugin, its servers). */
function countLabel(item: PluginItem, marketplaces: MarketplaceListing[] | null): string {
  let count = 1;
  if (item.kind === "plugin") {
    const [plugin, marketplace] = item.id.split("@");
    const entry = marketplaces?.find((market) => market.name === marketplace)?.plugins.find((candidate) => candidate.name === plugin);
    count = entry?.servers.length ?? 0;
    if (count === 0 && entry?.skills.length) {
      return entry.skills.length === 1 ? t("connectApps.count.skillOne") : t("connectApps.count.skillMany", { count: entry.skills.length });
    }
  }
  return count === 1 ? t("connectApps.count.connectorOne") : t("connectApps.count.connectorMany", { count });
}

/** The same subline for the bot scope: what the plugin brings to that bot. */
function botCountLabel(item: PluginItem, view: BotPluginsView | null): string {
  const contents = botPluginState(view, item.id)?.contents;
  const count = contents ? contents.agents.length + contents.commands.length + contents.skills.length : 0;
  return count === 1 ? t("connectApps.botPlugin.countOne") : t("connectApps.botPlugin.countMany", { count });
}

interface DetailContext {
  mcp: ReturnType<typeof useMcpServers>;
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

function mcpDetail(item: PluginItem, { mcp, mcpAccountDraft, setMcpAccountDraft }: DetailContext): DetailBase {
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
  if (remote && server.auth === "connected") {
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
function pluginDetail(item: PluginItem, { items, marketplaces, installing, openItem, uninstallPlugin, updatePlugin, scope, botCard }: DetailContext): DetailBase {
  const [plugin, marketplace] = item.id.split("@") as [string, string];
  const market = marketplaces?.find((entry) => entry.name === marketplace);
  const entry = market?.plugins.find((candidate) => candidate.name === plugin);
  const children = items.filter((candidate) => candidate.parent === item.key);
  const installedVersion = item.installedVersion ?? item.version;
  const subtitle = `${market?.source ?? marketplace}${installedVersion ? ` · ${installedVersion}` : ""}`;
  const versionDetails = [
    ...(installedVersion ? [{ label: t("connectApps.detail.version"), value: installedVersion }] : []),
    ...(item.updateAvailable ? [{
      label: t("connectApps.plugin.available"),
      value: item.installedVersion && item.version ? item.version : t("connectApps.plugin.newerFiles"),
    }] : []),
  ];
  // For a bot the page is that bot's install: the card says what it brings,
  // and its Update installs the marketplace's files again in place.
  if (scope === "bot") {
    return {
      item,
      subtitle,
      busy: installing !== null,
      details: [
        { label: t("connectApps.detail.source"), value: marketplace },
        ...versionDetails,
      ],
      children: (
        <>
          {item.description && <p className="px-1 text-[12.5px] leading-relaxed text-ink-secondary">{item.description}</p>}
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
      ...versionDetails,
      { label: t("connectApps.plugin.connectors"), value: String(entry?.servers.length ?? 0) },
      { label: t("connectApps.filter.skills"), value: String(entry?.skills.length ?? 0) },
    ],
    children: (
      <>
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
