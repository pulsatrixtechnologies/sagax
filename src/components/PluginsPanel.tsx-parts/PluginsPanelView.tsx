import { useRef, type ReactNode } from "react";
import { BookOpen, ClipboardPaste, KeyRound, Loader2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { canEditConfig } from "@/lib/viewer";
import { discoverItems, entryIcon, privateSkills } from "@/lib/installed-model";
import { connectedSummary, TAILSCALE_KEY, type PluginItem } from "@/lib/plugins-model";
import { organizationRows } from "@/lib/capabilities";
import { openSettings } from "@/lib/settings-link";
import { SavedKeysResetNotice } from "../SavedKeysReset";
import { setMine } from "@/lib/org-capabilities";
import {
  McpImportForm,
  McpMessages,
  McpReservedServers,
  McpServerEditor,
} from "../McpServersPanel";
import { DeveloperLink } from "../settings/DeveloperLink";
import { MyGithubSummary } from "../settings/MyConnectionsSettings";
import { usePersonalMcp } from "../plugins/PersonalServers";
import { productRows } from "../plugins/ProductRows";
import { usePersonProducts } from "@/lib/person-products";
import { ConnectAppsView, connectAppsTabLabel, connectedCounts, type ConnectAppsTab } from "../plugins/ConnectAppsView";
import type { Crumb } from "../Breadcrumb";
import { CATEGORY_MODAL } from "../category-modal";
import { BotCatalogPane } from "../lazy-bot-catalog";
import { AddMenu, bringsLabel, InstalledView } from "../plugins/InstalledView";
import { PLUGINS, pluginActionClass } from "../plugins/plugins-style";
import { DiscoverView, type FromSagaxRow } from "../plugins/DiscoverView";
import { AccountsView } from "../plugins/AccountsView";
import { SourcesView } from "../plugins/SourcesView";
import { OrgSourcesAccess } from "../plugins/OrgSourcesAccess";
import { OrgCapabilitiesAdmin, OrgCapabilitiesForMe } from "../plugins/OrgCapabilitiesSection";
import { accountConnectorRows, connectedAccountRows, connectorGroups, type AccountConnectorRow } from "../plugins/HarnessConnectorGroups";
import { PublishedPagesSettings } from "../PublishedPages";
import { MarketplacesSection } from "../plugins/MarketplacesSection";
import { DataCenterDialog } from "../plugins/DataCenterDialog";
import { ScopeToggle } from "../plugins/ScopeToggle";
import { MacAppsInstalledSection } from "../plugins/MacAppsView";
import { harnessGroupsInput } from "./useHarnessConnectors";
import { pluginSourceLabel } from "./helpers";
import { pageLabel, PluginsPanelSubpage } from "./PluginsPanelSubpage";
import type { PluginsPanelState } from "./usePluginsPanelState";
import type { PluginsPanelActions } from "./usePluginsPanelActions";
import { usePluginsInstalledEntries } from "./usePluginsInstalledEntries";
import { usePluginsSearch } from "./usePluginsSearch";

/** Plugins shell: title, scope, search, tabs and dialog frame for PluginsPanel. */
export function PluginsPanelView({ s, a }: { s: PluginsPanelState; a: PluginsPanelActions }) {
  const {
    state, dispatch, flushBotPatches, dialogRef, mcp, stack, page, push, popTo, botsBack, botSources, botFocus,
    filter, setFilter,
    type, setType, tab, setTab, harness,
    ownerOrAdmin, libraryEditor, perspicaxOrg, organization, dataCenterFor, setDataCenterFor,
    macAppsVisible, macAppsSetup, skills, panelError, setPanelError, panelNotice,
    scopeBot, setScopeChoice, scope, scopedPluginView, orgRevision, botCapabilities, botView,
    skillsLibraryOn, close, shownMarketplaces, grokConfigured, items, scopedItems,
    refreshAll, refreshing, chooseTab, featured,
  } = s;
  const {
    openItem, installFeatured, marketRoute, addMarketplace, setMarketplaceVisibility, refreshMarketplace,
    removeMarketplace, githubHere, openGithub, marketCredentials, marketSummaries,
    renderAction, renderBelow, botBusy, removeSuperseded,
  } = a;
  const marketBusy = s.marketBusy;
  // Me on an organization server: the person's own MCP servers, rows of
  // Installed and the same "+ Add" flows as Organization (2026-11-06)
  const personalHere = scope === "me" && Boolean(organization);
  const personal = usePersonalMcp(personalHere);
  // #4185: the person's Perspicax products, rows of the same Installed list
  // (none when the server is not linked or Perspicax has no such routes)
  const products = usePersonProducts(personalHere && perspicaxOrg !== null);
  const marketError = s.marketError;
  const marketNeedsToken = s.marketNeedsToken;

  // Recommended for you (#4207) on the screen Connect Apps opens on (Me):
  // the catalog's apps are picks there too. On an organization server one
  // becomes a server of the person's own (an app that signs in with OAuth or
  // needs nothing, at its one address); on a solo installation the
  // installation's servers are the person's, as under Organization.
  const personalListing = (item: PluginItem) => {
    if (!personalHere || item.kind !== "featured") return null;
    const listing = featured?.find((entry) => entry.id === item.id);
    if (!listing || listing.regions?.length) return null;
    const auth = listing.auth === "oauth" ? "oauth" as const : listing.auth === "none" ? "none" as const : null;
    return auth ? { id: listing.id, url: listing.url, auth } : null;
  };
  const canRecommend = (item: PluginItem) => {
    if (item.action === null) return false;
    if (item.kind === "plugin") return scope === "workspace" || Boolean(scopedPluginView?.canChange);
    if (scope === "workspace" || item.key === TAILSCALE_KEY) return true;
    if (scope !== "me" || item.kind !== "featured") return false;
    return personalHere ? personalListing(item) !== null : !mcp.restricted;
  };
  const discoverAction = (item: PluginItem) => {
    const listing = personalListing(item);
    if (!listing) return renderAction(item);
    return (
      <button type="button" data-personal-connect={item.id} disabled={personal.connecting !== null} className={pluginActionClass()}
        onClick={() => { setPanelError(null); void personal.connect(listing).catch((cause: unknown) => setPanelError(readableError(cause))); }}>
        {personal.connecting === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : t(item.action === "connect" ? "connectApps.action.connect" : "connectApps.action.add")}
      </button>
    );
  };

  const notices = (
    <>
      {panelError && <div role="alert" className="mx-6 mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger sm:mx-8">{panelError}</div>}
      {panelNotice && <div role="status" className="mx-6 mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning sm:mx-8">{panelNotice}</div>}
      <SavedKeysResetNotice panel />
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

  const { entries, botsForRows, toggleBotServers, entryActions, botsForEntry } = usePluginsInstalledEntries(s, a);

  // The breadcrumb: each page under the current one. A page opened from a
  // tab shows in that tab under Connect Apps' title: its first crumb is the
  // tab ("Installed"); Browse Bots too, from Discover (2026-10-28).
  const trail: Crumb[] = stack.slice(0, -1).map((entry, depth) => ({ label: pageLabel(entry, tab, items, entries, products.products), onSelect: () => popTo(depth) }));
  const skillsOn = skills !== null && skillsLibraryOn;
  // Only pass a page node when one is open: ConnectAppsView treats any
  // defined page as a subpage and hides the open tab's list.
  const subpage: ReactNode = page.page === "main" ? null : (
    <PluginsPanelSubpage
      s={s}
      a={a}
      products={products}
      trail={trail}
      entries={entries}
      botsForEntry={botsForEntry}
      botsForRows={botsForRows}
      toggleBotServers={toggleBotServers}
    />
  );

  const groups = connectorGroups(harnessGroupsInput(harness.answer, harness.loading, grokConfigured));
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
  const { searchField, searchResults } = usePluginsSearch(s, a, accountSections);

  const isOrgAdmin = perspicaxOrg?.viewerRole === "admin";
  const orgHere = isOrgAdmin && scope === "workspace" && perspicaxOrg !== null;
  // Sources: the GitHub connection row and the marketplaces (2026-10-29).
  // Bots and Pages are visible tabs (#2104, JC's review): a link selects one.
  const tabs: ConnectAppsTab[] = ["installed", "discover", "bots", "pages",
    ...(githubHere || marketRoute !== null || (marketSummaries?.length ?? 0) > 0 || orgHere ? ["sources" as const] : [])];

  // one "+ Add" menu (#2104): the server, the pasted config, the skill; an
  // entry shows only where it may act. It sits in Manage's title row.
  // Me offers the same entries as Organization (2026-11-06): on an
  // organization server they add the person's own servers, on a solo
  // installation the installation's (which are the person's).
  const addActions = [
    ...(personalHere ? [
      { id: "server", label: t("connectApps.manage.addServer"), icon: <KeyRound size={14} />, onPick: personal.startAdd, disabled: personal.busy },
      { id: "paste", label: t("mcp.import"), icon: <ClipboardPaste size={14} />, onPick: personal.startImport, disabled: personal.busy },
    ] : (scope === "workspace" || scope === "me") && !mcp.restricted ? [
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
          onRefresh={() => { refreshAll(); void harness.load(true); if (personalHere) { void personal.refresh(); void products.refresh(); } }}
          installed={(
            <InstalledView
              loading={mcp.servers === null}
              entries={entries}
              personal={personalHere ? [...personal.rows, ...productRows(products.products, (product) => push({ page: "product", id: product.id }))] : undefined}
              resolved={scope === "bot" ? botCapabilities.data : undefined}
              resolvedError={scope === "bot" && !botCapabilities.data ? botCapabilities.error : null}
              onRetryResolved={() => void botCapabilities.reload()}
              removingSuperseded={botBusy}
              onRemoveSuperseded={scope === "bot" && scopedPluginView?.canChange ? removeSuperseded : undefined}
              onToggleOrganization={(item, next) => {
                if (!item.orgDeclaration) return;
                void setMine(item.orgDeclaration, next).then(() => botCapabilities.reload(), (failure) => setPanelError(readableError(failure)));
              }}
              onToggleBuiltin={scope === "bot" && scopeBot ? (item, next) => {
                if (!item.builtin) return;
                dispatch({ type: "updateBot", botId: scopeBot.id, patch: { builtinPlugins: { ...scopeBot.builtinPlugins, [item.builtin]: next } } });
                // the resolver reads the saved bot: refresh once the patch landed
                void flushBotPatches(scopeBot.id).then(() => botCapabilities.reload(), (failure) => setPanelError(readableError(failure)));
              } : undefined}
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
                  claudeCode={!organization && canEditConfig(state.config) ? <DeveloperLink /> : undefined}
                />
              )}
              forms={scope === "workspace" || (scope === "me" && !personalHere) ? (
                <>
                  {/* lot 4: the organization's declarations, owned by Perspicax */}
                  {mcp.restricted && mcp.policy && <p role="status" className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("policy.mcpRestricted", { organization: mcp.policy.organizationName })}</p>}
                  <McpMessages mcp={mcp} />
                  <McpReservedServers mcp={mcp} />
                  <McpImportForm mcp={mcp} />
                  {mcp.editing === "new" && <div className="mb-4"><McpServerEditor mcp={mcp} /></div>}
                </>
              ) : personalHere ? (
                <>
                  {personal.forms}
                  {perspicaxOrg !== null && <OrgCapabilitiesForMe key={orgRevision ?? ""} />}
                </>
              ) : undefined}
            />
          )}
          discover={(
            <DiscoverView
              items={discoverItems(scopedItems, state.pluginsFocusApps ?? undefined)}
              loading={mcp.servers === null || (scope !== "workspace" && scopedPluginView === null)}
              catalogPending={featured === null}
              filter={filter}
              onFilter={setFilter}
              type={type}
              onType={setType}
              sourceLabel={pluginSourceLabel}
              extraSources={(shownMarketplaces ?? []).map((market) => market.name)}
              focus={state.pluginsFocusApps ?? undefined}
              onOpenItem={openItem}
              renderAction={discoverAction}
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
              // Recommended for you (#4207): what the person has in any
              // scope is not offered; under Me the catalog's apps are picks
              // too; only what can be connected here
              recommendFrom={scope === "me" ? discoverItems(items) : undefined}
              owned={[...items.filter((item) => item.installed).map((item) => item.name), ...entries.map((entry) => entry.name), ...personal.names]}
              canConnect={canRecommend}
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


