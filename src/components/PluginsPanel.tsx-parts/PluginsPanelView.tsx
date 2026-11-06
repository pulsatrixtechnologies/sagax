import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, ClipboardPaste, KeyRound, X } from "lucide-react";

import { confirmAsync } from "@/components/ConfirmProvider";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { canEditBotField } from "@/lib/bot-capabilities";
import { canEditConfig } from "@/lib/viewer";
import { discoverItems, entryIcon, installedEntries, privateSkills, type InstalledEntry } from "@/lib/installed-model";
import { connectedSummary } from "@/lib/plugins-model";
import { organizationRows } from "@/lib/capabilities";
import { openSettings } from "@/lib/settings-link";
import { setMine } from "@/lib/org-capabilities";
import {
  ClaudeCodeSwitches,
  McpImportForm,
  McpMessages,
  McpReservedServers,
  McpServerEditor,
} from "../McpServersPanel";
import { MyGithubSummary, MyMcpServers } from "../settings/MyConnectionsSettings";
import { ConnectAppsView, connectAppsTabLabel, connectedCounts, type ConnectAppsTab } from "../plugins/ConnectAppsView";
import type { Crumb } from "../Breadcrumb";
import { CATEGORY_MODAL } from "../category-modal";
import { BotCatalogPane } from "../lazy-bot-catalog";
import { catalogSections, type CatalogItem } from "@/lib/bot-catalog";
import { searchConnectApps, visibleResults, type SearchPage, type SearchResult, type SearchSource } from "@/lib/connect-apps-search";
import { ConnectAppsSearchField, ConnectAppsSearchResults } from "../plugins/ConnectAppsSearch";
import type { PublishedPageSummary } from "../../../shared/published-pages";
import { AddMenu, bringsLabel, InstalledView, type EntryActions } from "../plugins/InstalledView";
import { PLUGINS } from "../plugins/plugins-style";
import { DiscoverView, type FromSagaxRow } from "../plugins/DiscoverView";
import { AccountsView } from "../plugins/AccountsView";
import { SourcesView } from "../plugins/SourcesView";
import { OrgSourcesAccess } from "../plugins/OrgSourcesAccess";
import { OrgCapabilitiesAdmin, OrgCapabilitiesForMe } from "../plugins/OrgCapabilitiesSection";
import { accountConnectorRows, accountConnectorSub, connectedAccountRows, connectorGroups, type AccountConnectorRow } from "../plugins/HarnessConnectorGroups";
import { botServersAfter, botUsesServers } from "../plugins/BotsForView";
import { PublishedPagesSettings } from "../PublishedPages";
import { MarketplacesSection } from "../plugins/MarketplacesSection";
import { DataCenterDialog } from "../plugins/DataCenterDialog";
import { ScopeToggle } from "../plugins/ScopeToggle";
import { MacAppsInstalledSection } from "../plugins/MacAppsView";
import { GROK_CLOUD_CONNECTORS } from "../../../shared/grok-cloud-connectors";
import { pluginSourceLabel } from "./helpers";
import { pageLabel, PluginsPanelSubpage } from "./PluginsPanelSubpage";
import type { PluginsPanelState } from "./usePluginsPanelState";
import type { PluginsPanelActions } from "./usePluginsPanelActions";

/** Plugins shell: title, scope, search, tabs and dialog frame for PluginsPanel. */
export function PluginsPanelView({ s, a }: { s: PluginsPanelState; a: PluginsPanelActions }) {
  const {
    state, dispatch, dialogRef, mcp, stack, page, push, popTo, botsBack, botSources, botFocus, setBotFocus,
    search, setSearch, openedGroups, setOpenedGroups, activeResult, setActiveResult, filter, setFilter,
    type, setType, tab, setTab, harness,
    ownerOrAdmin, libraryEditor, perspicaxOrg, organization, dataCenterFor, setDataCenterFor,
    macAppsVisible, macAppsSetup, skills, setInstalling, panelError, setPanelError, panelNotice,
    scopeBot, setScopeChoice, scope, scopedPluginView, orgRevision, botCapabilities, botView,
    skillsLibraryOn, close, revealLater, shownMarketplaces, grokConfigured, items, scopedItems,
    refreshAll, refreshing, chooseTab, setMarketplaces, loadSkills, loadFeatured,
  } = s;
  const {
    openItem, installFeatured, marketRoute, addMarketplace, setMarketplaceVisibility, refreshMarketplace,
    removeMarketplace, githubHere, openGithub, marketCredentials, marketSummaries, installForBot,
    uninstallForBot, updatePlugin, renderAction, renderBelow, botBusy, removeSuperseded,
  } = a;
  const marketBusy = s.marketBusy;
  const marketError = s.marketError;
  const marketNeedsToken = s.marketNeedsToken;

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
  // the one install scope (this bot, me, organization), always live (#2104);
  // the view leaves it out on Bots and Pages, which do not depend on it
  const scopeNoteText = scope === "bot" && scopeBot
    ? [t("connectApps.scope.botNote", { name: scopeBot.name }), botView && !botView.canChange ? t("plugins.readOnly") : ""].filter(Boolean).join(" ")
    : t(scope === "me" ? "connectApps.scope.meNote" : "connectApps.scope.workspaceNote");
  const scopeToggle = (
    <div data-plugins-scope-bar>
      <ScopeToggle quiet scope={scope} botName={scopeBot?.name} organization={s.workspaceMarkets && s.mayManageOrganization} onScope={(next) => { setScopeChoice(next); setPanelError(null); }} describedBy="plugins-scope-note" title={scopeNoteText} />
    </div>
  );
  const scopeControl = (
    <div data-plugins-scope-notes>
      {/* #2104 (Grok Bot's look): no subtitle under the title; the note
          stays for screen readers and on the scope's tooltip */}
      <p id="plugins-scope-note" className="sr-only" data-plugins-scope-note={scope}>{scopeNoteText}</p>
      {scope !== "workspace" && scopedPluginView && scopedPluginView.marketplaces.length === 0 && (
        <p className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary" data-plugins-scope-empty>{t("connectApps.scope.noMarketplaces")}</p>
      )}
    </div>
  );

  // Manage > Installed: one entry per thing (installed-model.ts).
  const entries = useMemo(() => installedEntries(scopedItems, s.featured ?? []), [scopedItems, s.featured]);
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
    if (!(await confirmAsync({ title: t("connectApps.entry.removeConfirm", { name: entry.name }), confirmLabel: t("common.confirmRemove"), tone: "danger" }))) return;
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

  // The breadcrumb: each page under the current one. A page opened from a
  // tab shows in that tab under Connect Apps' title: its first crumb is the
  // tab ("Installed"); Browse Bots too, from Discover (2026-10-28).
  const trail: Crumb[] = stack.slice(0, -1).map((entry, depth) => ({ label: pageLabel(entry, tab, items, entries), onSelect: () => popTo(depth) }));
  const skillsOn = skills !== null && skillsLibraryOn;
  // Only pass a page node when one is open: ConnectAppsView treats any
  // defined page as a subpage and hides the open tab's list.
  const subpage: ReactNode = page.page === "main" ? null : (
    <PluginsPanelSubpage
      s={s}
      a={a}
      trail={trail}
      entries={entries}
      botsForEntry={botsForEntry}
      botsForRows={botsForRows}
      toggleBotServers={toggleBotServers}
    />
  );

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
  const groups = connectorGroups({
    claude: harness.answer?.claude ? { available: harness.answer.claude.available, reason: harness.answer.claude.reason, connectors: harness.answer.claude.connectors ?? [], manageUrl: harness.answer.manageUrl } : null,
    claudeLoading: harness.loading && !harness.answer,
    grok: grokConfigured ? { connectors: GROK_CLOUD_CONNECTORS } : null,
    codex: harness.answer?.codex ?? null,
  });
  // the engine accounts' connectors as rows (#2306): "From <provider>" in
  // Discover, rows of the Installed list in Manage, counted in "N connected"
  const accountSections = groups.map((group) => ({ group, rows: accountConnectorRows(group, items) }));
  const accountConnected = connectedAccountRows(groups);
  const openAccount = (row: AccountConnectorRow) => {
    if (row.engine !== "grok" || !row.id) return undefined;
    const item = items.find((candidate) => candidate.key === `grok:${row.id}`);
    return item ? () => openItem(item) : undefined;
  };
  const setUpEngine = () => {
    close();
    openSettings(dispatch, "engines");
  };
  const searchGroups = searching ? searchConnectApps({
    query: search,
    // a Grok connector is found as its account row (#2306)
    items: scopedItems.filter((item) => item.source !== "grok"),
    catalog: catalogItems,
    pages: searchPages ?? [],
    sources: searchSources,
    accounts: accountSections.flatMap(({ rows }) => rows.map((row) => ({ key: row.key, name: row.name, detail: accountConnectorSub(row) }))),
  }) : [];
  const searchLoading = searching && (searchPages === null || mcp.servers === null || (!botSources.data && !botSources.loadFailed));
  const changeSearch = (value: string) => {
    setSearch(value);
    setActiveResult(-1);
    setOpenedGroups(new Set());
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
    if (result.kind === "account") {
      // its row in Discover's "From <provider>", in view
      chooseTab("discover");
      setFilter("all");
      setType("any");
      revealLater(`[data-plugin-row="${CSS.escape(result.key)}"]`);
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
  // Sources: the GitHub connection row and the marketplaces (2026-10-29).
  // Bots and Pages are visible tabs (#2104, JC's review): a link selects one.
  const tabs: ConnectAppsTab[] = ["installed", "discover", "bots", "pages",
    ...(githubHere || marketRoute !== null || (marketSummaries?.length ?? 0) > 0 || orgHere ? ["sources" as const] : [])];

  // one "+ Add" menu (#2104): the server, the pasted config, the skill; an
  // entry shows only where it may act. It sits in Manage's title row.
  const addActions = [
    ...(scope === "workspace" && !mcp.restricted ? [
      { id: "server", label: t("connectApps.manage.addServer"), icon: <KeyRound size={14} />, onPick: mcp.startAdd, disabled: mcp.busy !== null },
      { id: "paste", label: t("mcp.import"), icon: <ClipboardPaste size={14} />, onPick: mcp.toggleImport, disabled: mcp.busy !== null },
    ] : []),
    ...(scope !== "bot" && skillsOn && (scope === "me" || ownerOrAdmin !== false || libraryEditor) ? [
      { id: "skill", label: t("connectApps.skill.new"), icon: <BookOpen size={14} />, onPick: () => push({ page: "skill" }) },
    ] : []),
  ];
  // "From Sagax" on the home (Grok Bot's "From Grok"): what is installed
  const fromSagax: FromSagaxRow[] = entries.map((entry) => ({ key: entry.key, item: entryIcon(entry), name: entry.name, sub: bringsLabel(entry.brings), status: entry.status }));

  return (
    <PluginsPanelFrame
      dialogRef={dialogRef}
      page={page}
      stackDepth={stack.length - 1}
      close={close}
      dataCenterFor={dataCenterFor}
      setDataCenterFor={setDataCenterFor}
      installFeatured={installFeatured}
      content={(
        <ConnectAppsView
          tab={tab}
          onTab={chooseTab}
          page={subpage ?? undefined}
          tabs={tabs}
          // what "N connected" counted (#2306): the connected rows Installed
          // lists, its plugins and the engine accounts' connectors
          counts={connectedCounts({ entries, engineConnected: accountConnected })}
          scope={scopeToggle}
          scopeNote={scopeControl}
          // the header's "N connected" and its icons (Grok Bot's Connect Apps)
          // counts the rows Manage lists, so the number matches what it opens
          connected={{ count: connectedCounts({ entries, engineConnected: accountConnected }).installed ?? 0, icons: connectedSummary(scopedItems).icons }}
          manageActions={addActions.length > 0 ? <AddMenu actions={addActions} /> : undefined}
          search={searchField}
          results={searchResults}
          notices={notices}
          // the one refresh (#2104): plugins, servers, skills, and the engine
          // accounts' connectors, together
          refreshing={refreshing || harness.loading}
          onRefresh={() => { refreshAll(); void harness.load(true); }}
          installed={(
            <InstalledView
              loading={mcp.servers === null}
              entries={entries}
              resolved={scope === "bot" ? botCapabilities.data : undefined}
              resolvedError={scope === "bot" && !botCapabilities.data ? botCapabilities.error : null}
              onRetryResolved={() => void botCapabilities.reload()}
              removingSuperseded={botBusy}
              onRemoveSuperseded={scope === "bot" && scopedPluginView?.canChange ? removeSuperseded : undefined}
              onToggleOrganization={(item, next) => {
                if (!item.orgDeclaration) return;
                void setMine(item.orgDeclaration, next).then(() => botCapabilities.reload(), (failure) => setPanelError(readableError(failure)));
              }}
              botName={scopeBot?.name}
              organization={scope === "bot" && botCapabilities.data ? organizationRows(botCapabilities.data.items) : []}
              skills={scope === "bot" ? [] : privateSkills(items)}
              sourceLabel={pluginSourceLabel}
              onOpenEntry={(entry) => openItem(entry.primary)}
              onOpenSkill={openItem}
              entryActions={entryActions}
              // one "+ Add" menu (#2104): the server, the pasted config, the
              // skill; an entry shows only where it may act
              add={addActions}
              addInTitle
              // lot 4: the organization's declarations (Perspicax), folded
              // at the end (#2104: Grok Bot's Manage opens on the list)
              organizationAdmin={scope === "workspace" && orgHere ? <OrgCapabilitiesAdmin /> : undefined}
              onDiscover={() => setTab("discover")}
              macApps={scope !== "bot" && macAppsVisible ? (
                <MacAppsInstalledSection
                  status={macAppsSetup}
                  onOpen={(app) => {
                    setTab("installed");
                    push(app === "messages" ? { page: "mac-messages" } : { page: "mac-app", app });
                  }}
                />
              ) : undefined}
              accounts={{ sections: accountSections, refreshing: harness.loading, onRefresh: () => void harness.load(true), onSetUp: setUpEngine, onOpen: openAccount }}
              providers={(
                <AccountsView
                  servers={organization ? <MyMcpServers /> : undefined}
                  claudeCode={!organization && canEditConfig(state.config) ? <ClaudeCodeSwitches /> : undefined}
                />
              )}
              forms={scope === "workspace" ? (
                <>
                  {/* lot 4: the organization's declarations, owned by Perspicax */}
                  {mcp.restricted && mcp.policy && <p role="status" className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("policy.mcpRestricted", { organization: mcp.policy.organizationName })}</p>}
                  <McpMessages mcp={mcp} />
                  <McpReservedServers mcp={mcp} />
                  <McpImportForm mcp={mcp} />
                  {mcp.editing === "new" && <div className="mb-4"><McpServerEditor mcp={mcp} /></div>}
                </>
              ) : scope === "me" && perspicaxOrg !== null ? <OrgCapabilitiesForMe key={orgRevision ?? ""} /> : undefined}
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
              fromSagax={fromSagax}
              onOpenFromSagax={(row) => {
                const entry = entries.find((candidate) => candidate.key === row.key);
                if (entry) openItem(entry.primary);
              }}
              onViewInstalled={() => chooseTab("installed")}
              accounts={accountSections}
              onOpenAccount={openAccount}
              accountsRefreshing={harness.loading}
              onAccountsRefresh={() => void harness.load(true)}
              onAccountsSetUp={setUpEngine}
              onAddCustom={scope === "workspace" && !mcp.restricted ? () => push({ page: "connector" }) : undefined}
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
      )}
    />
  );
}

function PluginsPanelFrame({
  dialogRef, page, stackDepth, close, content, dataCenterFor, setDataCenterFor, installFeatured,
}: {
  dialogRef: PluginsPanelState["dialogRef"];
  page: PluginsPanelState["page"];
  stackDepth: number;
  close: () => void;
  content: ReactNode;
  dataCenterFor: PluginsPanelState["dataCenterFor"];
  setDataCenterFor: PluginsPanelState["setDataCenterFor"];
  installFeatured: PluginsPanelActions["installFeatured"];
}) {
  const dataCenterAnchor = useRef<HTMLElement | null>(null);
  dataCenterAnchor.current = dataCenterFor?.anchor ?? null;

  return (
    <div
      className={CATEGORY_MODAL.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      {/* Plugins centred modal (decided exception like Settings): same
          size and close button as Browse Bots used to share. */}
      <div
        ref={dialogRef}
        data-tour="apps-panel"
        data-plugins-page={page.page}
        data-plugins-depth={stackDepth}
        data-gallery-frame=""
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugins-title"
        tabIndex={-1}
        className={cn("animate-pop-in", CATEGORY_MODAL.frame, PLUGINS.frame)}
      >
        <div className={CATEGORY_MODAL.content}>
          <button
            type="button"
            data-tour="apps-close"
            onClick={close}
            aria-label={t("common.close")}
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
          anchorRef={dataCenterAnchor}
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


