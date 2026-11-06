import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useConfirm } from "@/components/ConfirmProvider";
import { api, ApiError } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { WHOP_KEY, TAILSCALE_KEY, marketplacePluginKey, type PluginItem } from "@/lib/plugins-model";
import { openExternalLink } from "@/lib/app-links";
import {
  addMarketplace as addBotMarketplace,
  installPlugin as installBotPlugin,
  MARKETPLACE_ACCESS_CODES,
  removeMarketplace as removeBotMarketplace,
  setPluginConfig as setBotPluginConfig,
  setPluginEnabled as setBotPluginEnabled,
  uninstallPlugin as uninstallBotPlugin,
  updateMarketplace as updateBotMarketplace,
  type BotPluginsView,
  type MarketplaceVisibility,
} from "@/lib/my-connections";
import { botPluginState, botScopeMarketplaces, marketplaceRoute, marketplaceCredentialControls } from "@/lib/plugin-scope";
import { botPluginKey, engineGetsNothing, enginesLine } from "@/lib/capabilities";
import type { CapabilityForm, EngineParts } from "../../../shared/capabilities";
import { WhopAction, WhopBelow } from "../McpServersPanel";
import { cardActionClass } from "../category-modal";
import { pluginActionClass } from "../plugins/plugins-style";
import { GithubAccountSection } from "../plugins/GithubAccountSection";
import { MyGithubConnection } from "../settings/MyConnectionsSettings";
import { BotPluginCard } from "../plugins/BotPluginCard";
import type { PluginDetailProps, DetailInstallState } from "../plugins/PluginDetailView";
import { grokRowAction } from "./GrokConnectors";
import { githubPluginKey } from "./helpers";
import type { MarketplaceListing } from "./types";
import type { PluginsPanelState } from "./usePluginsPanelState";

/** Install, marketplace, bot-scope and row-action handlers for PluginsPanel. */
export function usePluginsPanelActions(s: PluginsPanelState) {
  const confirm = useConfirm();
  const {
    mcp, featured, setDataCenterFor, setInstalling, setPanelError, showDetail, push,
    setMarketBusy, setMarketError, setMarketNeedsToken, workspaceMarkets, mayManageOrganization,
    scope, botView, personalView, scopedPluginTarget, scopedPluginName, setScopedPluginView,
    loadMarketplaces, loadBotView, setMarketplaces, setPanelNotice, filter, setFilter,
    organization, items, scopeBotId, setBotBusy, botBusy, scopedPluginView, marketplaces,
    botCapabilities, scopeBot, loadSkills, loadFeatured, installing, setTailscaleView,
  } = s;

  const openItem = (item: PluginItem) => {
    if (item.kind === "skill") {
      push({ page: "skill", name: item.id });
      return;
    }
    if (item.key === TAILSCALE_KEY) {
      push({ page: "tailscale" });
      return;
    }
    // Whop's page is its MCP server's page.
    const key = item.key === WHOP_KEY && mcp.whopServer ? `mcp:${mcp.whopServer.name}` : item.key;
    push({ page: "detail", key });
  };

  const installFeatured = async (item: PluginItem, region?: string, anchor?: HTMLElement | null) => {
    const listing = featured?.find((entry) => entry.id === item.id);
    if (region === undefined && listing?.regions?.length) {
      if (!anchor) return;
      setDataCenterFor({ item, regions: listing.regions, defaultUrl: listing.url, anchor });
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
    void (async () => {
      if (!(await confirm({
        title: fromBot ? t("connectApps.market.removeFromBotConfirm", { name, bot: scopedPluginName }) : t("connectApps.market.removeConfirm", { name }),
        confirmLabel: t("common.confirmRemove"),
        tone: "danger",
      }))) return;
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
    })();
  };
  // The GitHub connection: the person's GitHub account (organization
  // server) and the one credential list, in both scopes, on the GitHub
  // plugin's page (2026-10-29)
  const githubHere = organization || marketRoute !== null;
  const githubKey = githubPluginKey(items);
  const githubSection = githubHere ? <GithubAccountSection connection={organization ? <MyGithubConnection /> : undefined} /> : null;
  /** The GitHub plugin's page, in the current tab: where the GitHub
   * connection is (a page of its own when no marketplace has the plugin). */
  const openGithub = () => s.setStack([{ page: "main" }, githubKey ? { page: "detail", key: githubKey } : { page: "github" }]);
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
    if (!scopedPluginTarget) return;
    const title = scope === "me"
      ? t("connectApps.mePlugin.uninstallConfirm", { name: id.slice(0, id.lastIndexOf("@")) })
      : t("connectApps.botPlugin.uninstallConfirm", { name: id.slice(0, id.lastIndexOf("@")), bot: scopedPluginName });
    void (async () => {
      if (!(await confirm({ title, confirmLabel: t("common.confirmRemove"), tone: "danger" }))) return;
      void botAction(`remove:${id}`, () => uninstallBotPlugin(scopedPluginTarget!, id));
    })();
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
   * (for everyone, on the bot in reach) and Install for <bot> beside the name
   * when that bot still needs it. Update lives in the Details card (Grok Bot
   * shows no Update pill in the header). */
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
    if (!(await confirm({ title: t("connectApps.plugin.uninstallConfirm", { name: plugin }), confirmLabel: t("common.confirmRemove"), tone: "danger" }))) return;
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
    if (item.key === TAILSCALE_KEY) {
      if (item.installed) return null;
      return (
        <button
          type="button"
          data-tailscale-connect
          onClick={() => openItem(item)}
          className={pluginActionClass()}
        >
          {t("connectApps.action.connect")}
        </button>
      );
    }
    if (item.kind === "plugin") {
      if (scope !== "workspace") {
        // installed on this bot: Install again updates it in place (its
        // switch and install date stay, server/bots/bot-plugins.ts)
        if (!scopedPluginView?.canChange || (item.installed && !item.updateAvailable)) return null;
        return (
          <button type="button" {...(item.installed ? { "data-bot-plugin-update": item.id } : { "data-bot-plugin-add": item.id })} disabled={botBusy !== null} onClick={() => installForBot(item.id)} className={pluginActionClass(item.installed ? "outline" : "fill")}>
            {botBusy === `install:${item.id}` ? <Loader2 size={13} className="mx-auto animate-spin" /> : t(item.installed ? "connectApps.plugin.update" : "connectApps.action.add")}
          </button>
        );
      }
      if (item.installed && !item.updateAvailable) return null;
      if (item.installed) {
        return (
          <button type="button" disabled={installing !== null} onClick={() => void updatePlugin(item)} className={pluginActionClass("outline")} data-plugin-update>
            {installing === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : t("connectApps.plugin.update")}
          </button>
        );
      }
      return (
        <button type="button" disabled={installing !== null} onClick={() => void installPlugin(item)} className={pluginActionClass()}>
          {installing === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : t("connectApps.action.add")}
        </button>
      );
    }
    if (item.kind === "featured") {
      return (
        <button type="button" disabled={installing !== null} onClick={(event) => void installFeatured(item, undefined, event.currentTarget)} className={pluginActionClass()}>
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

  const removeSuperseded = (item: Parameters<typeof botPluginKey>[0]) => {
    const key = botPluginKey(item);
    if (!key || !scopeBotId || botBusy !== null) return;
    if (!(scope === "bot" && scopedPluginView?.canChange)) return;
    void botAction(`remove:${key}`, () => uninstallBotPlugin(scopeBotId, key));
  };

  return {
    openItem, installFeatured, marketAction, marketRoute, addMarketplace, setMarketplaceVisibility,
    refreshMarketplace, removeMarketplace, githubHere, githubKey, githubSection, openGithub,
    marketCredentials, marketSummaries, installForBot, uninstallForBot, toggleForBot, botCard,
    detailHead, engineInfo, installPlugin, updatePlugin, uninstallPlugin, renderAction, renderBelow,
    setTailscaleView, botBusy, removeSuperseded,
  };
}

export type PluginsPanelActions = ReturnType<typeof usePluginsPanelActions>;
