import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronRight, ClipboardPaste, Compass, KeyRound, Link2, Loader2, Power, Puzzle, Store, Trash2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { canEditConfig } from "@/lib/viewer";
import { discoverItems, privateSkills, type InstalledEntry } from "@/lib/installed-model";
import { TAILSCALE_KEY, WHOP_KEY, type PluginItem } from "@/lib/plugins-model";
import { botSwitchPatch, installationServerName, organizationRows, visibleCapabilities } from "@/lib/capabilities";
import { canEditBotField } from "@/lib/bot-capabilities";
import { loadBotPlugins, installPlugin as installBotPlugin, uninstallPlugin as uninstallBotPlugin } from "@/lib/my-connections";
import { normalProductId } from "../../../shared/bot-products";
import { declarationForms, entryKind, groupByVendor, inLanguage, kindCounts as countKinds, kindOf, whereLabel, type ConnectAppsKind } from "@/lib/capability-kinds";
import { botPluginState } from "@/lib/plugin-scope";
import { api } from "@/state/store";
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
import { productRows, VendorArt, vendorLine, vendorOnCount, worseState, type ProductRowsContext, type VendorPlugins } from "../plugins/ProductRows";
import { productPlugins } from "@/lib/product-plugins";
import { ItemTrailer, type ChooseBots, type ItemMenuActions } from "../plugins/ItemTrailer";
import { InstallMenu } from "../plugins/InstallMenu";
import { statusState, type RowState } from "../plugins/StateIcon";
import { UpdateNotice } from "../plugins/UpdateNotice";
import { lastUpdateOf, updateKindOf, updateOf, useCapabilityUpdates, type UpdateKind } from "@/lib/capability-updates";
import { usePersonProducts } from "@/lib/person-products";
import { ConnectAppsView, DiscoverFilter, SortControl, UpdateAllPill, connectAppsTabLabel, filterChips, filterLabel, type ConnectAppsSort, type ConnectAppsTab } from "../plugins/ConnectAppsView";
import type { Crumb } from "../Breadcrumb";
import { CATEGORY_MODAL } from "../category-modal";
import { BotCatalogPane } from "../lazy-bot-catalog";
import { AddMenu, InstalledRow, InstalledView, type AddAction } from "../plugins/InstalledView";
import { PLUGINS, pluginActionClass } from "../plugins/plugins-style";
import { DiscoverView } from "../plugins/DiscoverView";
import { AccountsView } from "../plugins/AccountsView";
import { SourcesView } from "../plugins/SourcesView";
import { OrgCapabilitiesForMe, orgCapabilitiesOfForms, useOrgCapabilitiesForMe, vendorSkillsOf } from "../plugins/OrgCapabilitiesSection";
import { accountConnectorRows, connectorGroups, type AccountConnectorRow } from "../plugins/HarnessConnectorGroups";
import { PublishedPagesSettings } from "../PublishedPages";
import { MarketplacesSection } from "../plugins/MarketplacesSection";
import { DataCenterDialog } from "../plugins/DataCenterDialog";
import { MacAppsInstalledSection } from "../plugins/MacAppsView";
import { pluginSourceLabel, skillReadOnlyReason } from "./helpers";
import { grokRowAction } from "./GrokConnectors";
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
    scopeBot, scope, scopedPluginView, orgRevision, botCapabilities, botView,
    skillsLibraryOn, close, shownMarketplaces, grokConfigured, items, scopedItems,
    refreshAll, refreshing, chooseTab, featured, kind, setKind, viewChosen, skillsRoute, loadSkills, installing, justAdded,
  } = s;
  const {
    openItem, installFeatured, marketRoute, addMarketplace, setMarketplaceVisibility, refreshMarketplace,
    removeMarketplace, githubHere, openGithub, marketCredentials, marketSummaries,
    renderAction, renderBelow, botBusy, removeSuperseded, toggleForBot, installPlugin, installForBot, queued,
  } = a;
  const marketBusy = s.marketBusy;
  const officialErrors = s.officialErrors;
  // Me on an organization server: the person's own MCP servers, rows of
  // Installed and the same "+ Add" flows as Organization (2026-11-06)
  const personalHere = scope === "me" && Boolean(organization);
  const personal = usePersonalMcp(personalHere);
  // #4185: the person's Perspicax products, rows of the same Installed list
  // (none when the server is not linked or Perspicax has no such routes)
  const products = usePersonProducts((scope === "me" || scope === "bot") && perspicaxOrg !== null);
  // what the console offers the person, of each kind (their own switch)
  const orgMine = useOrgCapabilitiesForMe(personalHere && perspicaxOrg !== null);
  const [sort, setSort] = useState<ConnectAppsSort>("default");
  // #4504: the count, the items with an update, update one and update all
  const updates = useCapabilityUpdates();
  const rowUpdate = (kind: UpdateKind, name: string, fallback?: () => void, key?: string) => {
    const item = updateOf(updates.data, kind, name, key);
    if (item?.canUpdate) return { running: updates.updatingAll || updates.running.has(item.key), onUpdate: () => void updates.update([item.key]) };
    return fallback ? { running: false, onUpdate: fallback } : null;
  };
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
  // #4453: a row of Discover is "Install" with a small menu (For all my
  // bots, For one bot...); opened from a bot's page it installs on that bot.
  const discoverAction = (item: PluginItem, variant: "card" | "banner" = "card") => {
    const menuBots = editableBots.map((bot) => ({ id: bot.id, name: bot.name }));
    const listing = personalListing(item);
    const handled = item.key === WHOP_KEY || item.key === TAILSCALE_KEY || grokRowAction(item) !== undefined;
    const label = t("connectApps.install");
    if (!handled && !item.installed && item.kind === "plugin") {
      const at = item.id.lastIndexOf("@");
      const allBots = scope === "workspace" ? () => void installPlugin(item) : () => installForBot(item.id, "card");
      if (scope !== "workspace" && !scopedPluginView?.canChange) return null;
      const busy = installing.has(item.id);
      if (scope === "bot") return <button type="button" data-bot-plugin-add={item.id} disabled={busy} onClick={allBots} className={pluginActionClass()}>{busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : label}</button>;
      return (
        <InstallMenu iconOnly={variant === "card"} name={item.name} label={label} busy={busy} disabled={busy} onAll={allBots}
          bots={scope === "me" && at > 0 ? menuBots : undefined}
          onBots={(botIds) => { void queued([item.id], async () => { await Promise.all(botIds.map((botId) => installBotPlugin(botId, item.id.slice(at + 1), item.id.slice(0, at)))); void refreshAll(); }); }} />
      );
    }
    if (!handled && !item.installed && item.kind === "featured") {
      const oneBot = !listing && scope !== "bot" && menuBots.length > 0;
      const busy = installing.has(item.id) || (listing !== null && personal.connecting === item.id);
      return (
        <InstallMenu iconOnly={variant === "card"} name={item.name} label={label} busy={busy} disabled={busy}
          onAll={(anchor) => {
            if (listing) { setPanelError(null); void personal.connect(listing).catch((cause: unknown) => setPanelError(readableError(cause))); return; }
            void installFeatured(item, undefined, anchor);
          }}
          bots={oneBot ? menuBots : undefined}
          onBots={(botIds, anchor) => void installFeatured(item, undefined, anchor, (name) => { for (const bot of editableBots) toggleBotServerNames(bot.id, [name], botIds.includes(bot.id)); })} />
      );
    }
    // an installed item with an update waiting: the card's button is Update
    const waiting = item.installed ? rowUpdate(updateKindOf(item.kind), item.name, undefined, item.updateKey) : null;
    if (waiting) {
      return (
        <button type="button" data-card-update={waiting.running ? "running" : ""} disabled={waiting.running} onClick={waiting.onUpdate}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent/15 px-3 text-[13px] text-accent-text hover:bg-accent/25 disabled:opacity-70">
          {waiting.running ? <Loader2 size={13} className="animate-spin" /> : null}{waiting.running ? t("connectApps.updates.updating") : t("connectApps.plugin.update")}
        </button>
      );
    }
    if (!listing) return renderAction(item);
    return (
      <button type="button" data-personal-connect={item.id} disabled={personal.connecting !== null} className={pluginActionClass()}
        onClick={() => { setPanelError(null); void personal.connect(listing).catch((cause: unknown) => setPanelError(readableError(cause))); }}>
        {personal.connecting === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : label}
      </button>
    );
  };


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
    : t(scope === "me" ? "connectApps.scope.meNote" : organization ? "connectApps.scope.workspaceNote" : "connectApps.scope.serverNote");
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

  const { entries: ownEntries, botsForRows, toggleBotServers, toggleBotServerNames, entryActions, botsForEntry, editableBots } = usePluginsInstalledEntries(s, a);
  // a marketplace plugin named for a product group of the console joins that
  // group (lib/product-plugins): its card and page, the product's logo
  const productGroups = (scope === "me" || scope === "bot") && perspicaxOrg !== null
    ? groupByVendor(products.products).filter((vendor) => vendor.products.some((product) => product.group)) : [];
  const grouping = productPlugins(productGroups, ownEntries);
  const entries: InstalledEntry[] = grouping.groupOf.size === 0 ? ownEntries : ownEntries.map((entry) => {
    const vendor = productGroups.find((group) => group.key === grouping.groupOf.get(entry.key));
    const mark = vendor ? vendor.icon ?? vendor.products.find((product) => product.icon)?.icon : undefined;
    return mark && (mark.url || mark.domain) ? { ...entry, logo: mark.url ?? null, domain: mark.domain ?? null } : entry;
  });
  const groupedKeys = new Set(grouping.groupOf.keys());

  const groups = connectorGroups(harness.answer, { loading: harness.loading, grokConfigured });
  // the engine accounts' connectors as rows (#2306): "From <provider>" in
  // Connectors > Discover, rows of Connectors > Yours, counted on its tab
  const accountSections = groups.map((group) => ({ group, rows: accountConnectorRows(group, items) }));
  // The breadcrumb: each page under the current one. A page opened from a
  // tab shows in that tab under Connect Apps' title: its first crumb is the
  // tab ("Installed"); Browse Bots too, from Discover (2026-10-28).
  const trail: Crumb[] = stack.slice(0, -1).map((entry, depth) => ({ label: pageLabel(entry, tab, items, entries, products.products, kind, orgMine.items ?? [], accountSections.flatMap((section) => section.rows)), onSelect: () => popTo(depth) }));
  const skillsOn = skills !== null && skillsLibraryOn;
  // the console's products: the person's bots and the one write they all share
  const productBots = state.bots.filter((bot) => !bot.hidden && canEditBotField(state.config, bot, "products"));
  const setProducts = (botIds: readonly string[], productIds: readonly string[], next: boolean) => {
    for (const botId of botIds) {
      const bot = state.bots.find((candidate) => candidate.id === botId);
      if (!bot) continue;
      dispatch({ type: "updateBot", botId, patch: { products: { ...bot.products, ...Object.fromEntries(productIds.map((id) => [normalProductId(id), next])) } } });
    }
    // the resolver reads the saved bot: refresh once every patch landed
    void Promise.all(botIds.map((botId) => flushBotPatches(botId))).then(() => botCapabilities.reload(), (failure) => setPanelError(readableError(failure)));
  };
  const productCtx: ProductRowsContext = {
    bots: productBots.map((bot) => ({ id: bot.id, name: bot.name, products: bot.products })),
    ...(scope === "bot" && scopeBot ? { forBot: { id: scopeBot.id, name: scopeBot.name, products: scopeBot.products } } : {}),
    ...(scope === "bot" && botView && !botView.canChange ? { lockedReason: t("plugins.readOnly") } : {}),
    setProducts,
    onOpen: (product) => push({ page: "product", id: product.id }),
  };
  // Only pass a page node when one is open: ConnectAppsView treats any
  // defined page as a subpage and hides the open tab's list.
  const subpage: ReactNode = page.page === "main" ? null : (
    <PluginsPanelSubpage
      s={s}
      a={a}
      products={products}
      lastUpdateInfo={(kind, name) => lastUpdateOf(updates.data, kind, name)}
      updateInfo={(kind, name, key, organizationId) => updateOf(updates.data, kind, name, key, organizationId)}
      itemUpdate={(kind, name, key) => {
        const info = updateOf(updates.data, kind, name, key);
        if (!info) return undefined;
        const row = rowUpdate(kind, name, undefined, key);
        return { from: info.installedVersion, to: info.availableVersion, notes: info.updateNotes, running: row?.running ?? false, onUpdate: row?.onUpdate };
      }}
      consoleName={perspicaxOrg !== null ? t("connectApps.console.title", { org: perspicaxOrg.org.name }) : undefined}
      vendorSkills={(vendorKey) => groupSkills(vendorKey)}
      vendorPlugins={(vendorKey) => {
        const plugins = pluginsOfGroup(vendorKey);
        if (plugins.length === 0) return undefined;
        const card = vendorPlugins(vendorKey);
        return {
          off: card?.off ?? false,
          state: card?.state ?? null,
          rows: plugins.map((entry) => ({ key: entry.key, node: <InstalledRow entry={entry} onOpen={() => openItem(entry.primary)} actions={entryActions(entry)} trailer={entryTrailer(entry)} /> })),
        };
      }}
      accountRows={accountSections.flatMap((section) => section.rows)}
      orgItems={orgMine.items ?? []}
      productCtx={productCtx}
      trail={trail}
      entries={entries}
      botsForEntry={botsForEntry}
      botsForRows={botsForRows}
      toggleBotServers={toggleBotServers}
    />
  );

  const openAccount = (row: AccountConnectorRow) => {
    // a Grok connector the catalog knows opens its page; every other account connector opens the account's page
    const item = row.engine === "grok" && row.id ? items.find((candidate) => candidate.key === `grok:${row.id}`) : undefined;
    return item ? () => openItem(item) : () => push({ page: "account", key: row.key });
  };
  const setUpEngine = () => {
    close();
    openSettings(dispatch, "engines");
  };
  const { searchField, searchResults } = usePluginsSearch(s, a, accountSections);

  // #4453: Yours and Discover are the two views of each kind; Bot templates,
  // Published pages and Sources open from the title bar's "..."
  const sourcesHere = githubHere || marketRoute !== null || (marketSummaries?.length ?? 0) > 0;
  const tabs: ConnectAppsTab[] = ["installed", "discover", "bots", "pages", ...(sourcesHere ? ["sources" as const] : [])];

  // The one "+ Add" (#2104; #4453: by kind): every way to add something of
  // the kind open; an entry shows only where it may act. Me offers the same
  // server entries as Organization (2026-11-06): on an organization server
  // they add the person's own servers, on a solo installation the
  // installation's (which are the person's).
  const canInstallPlugins = scope === "workspace" || Boolean(scopedPluginView?.canChange);
  const addByKind: Record<ConnectAppsKind, AddAction[]> = {
    skills: scope !== "bot" && skillsOn && (scope === "me" || ownerOrAdmin !== false || libraryEditor) ? [
      { id: "skill", label: t("connectApps.skill.new"), icon: <BookOpen size={14} />, onPick: () => push({ page: "skill" }) },
    ] : [],
    connectors: [
      ...(scope !== "bot" ? [{ id: "catalog", label: t("connectApps.add.fromCatalog"), icon: <Compass size={14} />, onPick: () => chooseTab("discover") }] : []),
      ...(personalHere ? [
        { id: "server", label: t("connectApps.manage.addServer"), icon: <KeyRound size={14} />, onPick: personal.startAdd, disabled: personal.busy },
        { id: "paste", label: t("mcp.import"), icon: <ClipboardPaste size={14} />, onPick: personal.startImport, disabled: personal.busy },
      ] : (scope === "workspace" || scope === "me") && !mcp.restricted ? [
        { id: "server", label: t("connectApps.manage.addServer"), icon: <KeyRound size={14} />, onPick: mcp.startAdd, disabled: mcp.busy !== null },
        { id: "paste", label: t("mcp.import"), icon: <ClipboardPaste size={14} />, onPick: mcp.toggleImport, disabled: mcp.busy !== null },
      ] : []),
      ...(scope === "workspace" && !mcp.restricted ? [{ id: "url", label: t("connectApps.addCustomConnector"), icon: <Link2 size={14} />, onPick: () => push({ page: "connector" }) }] : []),
    ],
    plugins: [
      ...(canInstallPlugins ? [{ id: "marketplace-plugin", label: t("connectApps.add.fromMarketplace"), icon: <Compass size={14} />, onPick: () => chooseTab("discover") }] : []),
      ...(sourcesHere && marketRoute !== null ? [{ id: "marketplace", label: t("connectApps.add.marketplace"), icon: <Store size={14} />, onPick: () => chooseTab("sources") }] : []),
    ],
  };
  const addActions = addByKind[kind];

  // #4453 (decided 2026-11-16): the right side of every row says where the
  // item is on, then its switch (all of the person's bots, or the one bot
  // the window was opened from), then "..."; the same menu on a right click.
  const everyone = whereLabel(1, 1);
  const noBot = whereLabel(0, 1);
  const choosePluginBots = (pluginId: string): ChooseBots | undefined => {
    const at = pluginId.lastIndexOf("@");
    if (at <= 0 || editableBots.length < 2) return undefined;
    return {
      load: () => Promise.all(editableBots.map(async (bot) => {
        const view = await loadBotPlugins(bot.id).catch(() => null);
        return { id: bot.id, name: bot.name, on: Boolean(view && botPluginState(view, pluginId)?.installed?.enabled) };
      })),
      save: async (next) => {
        try {
          for (const [botId, on] of Object.entries(next)) {
            if (on) await installBotPlugin(botId, pluginId.slice(at + 1), pluginId.slice(0, at));
            else await uninstallBotPlugin(botId, pluginId);
          }
        } catch (cause) {
          setPanelError(readableError(cause));
        }
        refreshAll();
      },
    };
  };
  /** an entry's "..." menu and its "Update" mark: its own row's, and on its product's card */
  const entryMenu = (entry: InstalledEntry) => {
    const own = { ...entryActions(entry) };
    const kindOfEntry = updateKindOf(entry.primary.kind);
    const update = rowUpdate(kindOfEntry, entry.name, own.update, entry.primary.updateKey);
    const found = updateOf(updates.data, kindOfEntry, entry.name, entry.primary.updateKey);
    if (found?.canUpdate) own.update = () => void updates.update([found.key]);
    const base: ItemMenuActions = {
      detail: () => openItem(entry.primary),
      ...(own.update ? { update: own.update, updateWaiting: entry.updateAvailable } : {}),
      ...(own.links ? { links: own.links } : {}),
      ...(own.remove ? { remove: own.remove } : {}),
    };
    return { base, update };
  };
  /** the skills the plugins of a product group bring: their skill rows, and the names an install holds without rows (a person's or a bot's own) */
  const pluginSkillsOf = (vendorKey: string): Array<{ name: string; description: string; onOpen?: () => void }> =>
    entries.filter((entry) => grouping.groupOf.get(entry.key) === vendorKey).flatMap((entry) => {
      const plugin = entry.members.find((member) => member.kind === "plugin");
      const rows = items.filter((item) => item.kind === "skill" && (item.parent === entry.primary.key || entry.members.some((member) => member.key === item.key)));
      const held = (plugin ? botPluginState(scopedPluginView ?? null, plugin.id)?.contents?.skills ?? [] : []).filter((name) => !rows.some((row) => row.name === name));
      return [
        ...rows.map((row) => ({ name: row.name, description: row.description, onOpen: () => openItem(row) })),
        ...held.map((name) => ({ name, description: "", onOpen: () => openItem(entry.primary) })),
      ];
    });
  const pluginsOfGroup = (vendorKey: string) => entries.filter((entry) => grouping.groupOf.get(entry.key) === vendorKey);
  /** the skills of a product group: the console's for its vendor, then its plugins'; the ONE list its card line, its page header, its Skills tab and its Details count */
  const groupSkills = (vendorKey: string) => [...vendorSkillsOf(orgMine, vendorKey), ...pluginSkillsOf(vendorKey)];
  /** whether a grouped plugin is on, as its own row's switch says (the person's or the bot's install); unknown reads as on */
  const pluginOn = (entry: InstalledEntry) => {
    const plugin = entry.members.find((member) => member.kind === "plugin");
    if (!plugin || !scopedPluginView) return true;
    return Boolean(botPluginState(scopedPluginView, plugin.id)?.installed?.enabled);
  };
  /** what a product group's card carries of its plugins: "plugin off" on its line, their state in its icon, their Update, page, switch and Uninstall in its menu */
  const vendorPlugins = (vendorKey: string): VendorPlugins | undefined => {
    const plugins = pluginsOfGroup(vendorKey);
    if (plugins.length === 0) return undefined;
    const menus = plugins.map((entry) => ({ entry, on: pluginOn(entry), ...entryMenu(entry) }));
    const updating = menus.find((menu) => menu.update);
    const updater = menus.find((menu) => menu.base.update);
    const one = menus.length === 1;
    const change = scopedPluginView?.canChange ? toggleForBot : undefined;
    return {
      off: menus.some((menu) => !menu.on),
      state: menus.reduce<RowState | undefined>((worst, menu) => worseState(worst, statusState(menu.entry.status, () => openItem(menu.entry.primary))), undefined) ?? null,
      update: updating?.update ?? null,
      actions: {
        ...(updater?.base.update ? { update: updater.base.update, updateWaiting: menus.some((menu) => menu.entry.updateAvailable) } : {}),
        links: menus.flatMap((menu) => [
          { id: `plugin-page:${menu.entry.key}`, label: t("connectApps.vendor.pluginPage", { name: menu.entry.name }), icon: <Puzzle size={14} />, run: () => openItem(menu.entry.primary) },
          ...(change && menu.entry.members.some((member) => member.kind === "plugin") ? [{
            id: `plugin-toggle:${menu.entry.key}`,
            label: t(menu.on ? "connectApps.vendor.pluginTurnOff" : "connectApps.vendor.pluginTurnOn", { name: menu.entry.name }),
            icon: <Power size={14} />,
            run: () => change(menu.entry.members.find((member) => member.kind === "plugin")!.id, !menu.on),
          }] : []),
          ...(menu.base.links ?? []).map((link) => ({ ...link, id: `${link.id}:${menu.entry.key}` })),
          ...(!one && menu.base.remove ? [{ id: `plugin-remove:${menu.entry.key}`, label: t("connectApps.vendor.pluginRemove", { name: menu.entry.name }), icon: <Trash2 size={14} />, run: menu.base.remove }] : []),
        ]),
        ...(one && menus[0]!.base.remove ? { remove: menus[0]!.base.remove, removeLabel: t("connectApps.vendor.pluginRemove", { name: menus[0]!.entry.name }) } : {}),
      },
    };
  };
  const entryTrailer = (entry: InstalledEntry) => {
    const plugin = entry.members.find((member) => member.kind === "plugin");
    const state = statusState(entry.status, () => openItem(entry.primary));
    const { base, update } = entryMenu(entry);
    if (plugin && scope !== "workspace" && scopedPluginView) {
      const installed = botPluginState(scopedPluginView, plugin.id)?.installed;
      const change = scopedPluginView.canChange ? (next: boolean) => toggleForBot(plugin.id, next) : undefined;
      if (!installed) return <ItemTrailer update={update} state={state} name={entry.name} where={scope === "bot" ? "bot" : noBot} actions={base} />;
      if (scope === "bot") return <ItemTrailer update={update} state={state} name={entry.name} where="bot" on={installed.enabled} busy={botBusy !== null} onToggle={change} lockedReason={t("plugins.readOnly")} actions={base} />;
      const where = installed.enabled ? everyone : noBot;
      return (
        <ItemTrailer update={update} state={state} name={entry.name} where={where} whereKind={where.kind} on={installed.enabled} busy={botBusy !== null} onToggle={change} lockedReason={t("plugins.readOnly")}
          actions={{ ...base, ...(change ? { allBots: () => change(true), offEverywhere: () => change(false) } : {}), choose: choosePluginBots(plugin.id) }} />
      );
    }
    if (!plugin && scope === "workspace" && entry.servers.length > 0) {
      const server = entry.servers.length === 1 ? mcp.servers?.find((candidate) => candidate.name === entry.servers[0]) : undefined;
      const reached = botsForRows(entry).filter((bot) => bot.on).length;
      const where = whereLabel(reached, editableBots.length);
      const everywhere = (on: boolean) => { for (const bot of editableBots) toggleBotServers(entry, bot.id, on); };
      return (
        <ItemTrailer update={update} state={state} name={entry.name} where={where} whereKind={where.kind} on={server ? server.enabled : undefined} busy={mcp.busy !== null}
          onToggle={server && !mcp.restricted ? () => void mcp.toggle(server) : undefined}
          lockedReason={mcp.policy ? t("policy.mcpRestricted", { organization: mcp.policy.organizationName }) : undefined}
          actions={{
            ...base,
            allBots: () => everywhere(true),
            offEverywhere: () => everywhere(false),
            ...(editableBots.length > 1 ? {
              choose: {
                load: () => botsForRows(entry),
                save: (next: Record<string, boolean>) => { for (const [botId, on] of Object.entries(next)) toggleBotServers(entry, botId, on); },
              },
            } : {}),
          }} />
      );
    }
    return <ItemTrailer update={update} state={state} name={entry.name} actions={base} />;
  };
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const skillTrailer = (item: PluginItem) => {
    const skill = skills?.find((candidate) => candidate.name === item.id);
    const detail = { detail: () => openItem(item) };
    if (!skill) return <ItemTrailer name={item.name} actions={detail} />;
    const reason = skillReadOnlyReason(s, skill);
    const flip = (next: boolean) => {
      setSkillBusy(skill.name);
      setPanelError(null);
      void api(`${skillsRoute}/${encodeURIComponent(skill.name)}`, { method: "PATCH", body: JSON.stringify({ enabled: next }) })
        .then(() => loadSkills(), (failure: unknown) => setPanelError(readableError(failure)))
        .finally(() => setSkillBusy(null));
    };
    const where = scope === "bot" ? "bot" as const : skill.enabled ? everyone : noBot;
    const skillUpdate = updateOf(updates.data, "skill", item.name, item.updateKey);
    return (
      <ItemTrailer update={rowUpdate("skill", item.name, undefined, item.updateKey)} name={item.name} where={where} whereKind={typeof where === "string" ? undefined : where.kind} on={skill.enabled} busy={skillBusy !== null} onToggle={reason ? undefined : flip} lockedReason={reason}
        actions={{ ...detail, ...(skillUpdate?.canUpdate ? { update: () => void updates.update([skillUpdate.key]) } : {}), ...(reason || scope === "bot" ? {} : { allBots: () => flip(true), offEverywhere: () => flip(false) }) }} />
    );
  };

  const consoleTitle = perspicaxOrg && t("connectApps.console.title", { org: perspicaxOrg.org.name });
  const consoleRows = (scope === "me" || scope === "bot") && consoleTitle && kind !== "skills"
    ? productRows(products.products, productCtx, {
      mode: kind, sortByName: sort === "name",
      onOpenVendor: (key) => push({ page: "vendor", key, connectors: kind === "connectors" }),
      ...(kind === "plugins" ? { plugins: vendorPlugins, skills: (key: string) => groupSkills(key).length } : {}),
    }, kind === "plugins" && sort === "update" ? (key) => Boolean(vendorPlugins(key)?.update || vendorPlugins(key)?.actions.updateWaiting) : undefined)
    : [];
  // one featured slide per vendor the console files products under: its name, logo and
  // line are the console's data (never written here)
  const vendorSlides = perspicaxOrg !== null ? groupByVendor(products.products).filter((vendor) => vendor.products.some((product) => product.group)).map((vendor) => ({
    key: vendor.key,
    consoleName: t("connectApps.console.title", { org: perspicaxOrg.org.name }),
    name: vendor.name,
    line: vendor.products.map((product) => product.description).find(Boolean) ?? (vendor.products.length === 1 ? t("connectApps.vendor.productOne") : t("connectApps.vendor.productMany", { count: vendor.products.length })),
    art: <VendorArt vendor={vendor} />,
    onGo: () => push({ page: "vendor", key: vendor.key }),
  })) : [];
  // a bundle the person has not turned on is a card of Discover > Plugins too (the slide stays a slide)
  const bundleCards = perspicaxOrg !== null ? groupByVendor(products.products)
    .filter((vendor) => vendor.products.some((product) => product.group) && vendorOnCount(vendor, productCtx) === 0)
    .map((vendor) => {
      const line = inLanguage(vendor.description, activeLocale()) ?? vendor.products.map((product) => product.description).find(Boolean) ?? "";
      const mark = vendor.icon ?? vendor.products.find((product) => product.icon)?.icon;
      const item: PluginItem = {
        key: `vendor:${vendor.key}`, kind: "plugin", id: vendor.key, name: vendor.name, description: line, category: "other",
        installed: false, status: "available", action: "add", source: "console",
        ...(mark?.url ? { logo: mark.url } : {}), ...(mark?.domain ? { domain: mark.domain } : {}),
      };
      return {
        item, title: t("connectApps.featured.fromConsole", { console: t("connectApps.console.title", { org: perspicaxOrg.org.name }) }),
        from: vendorLine(vendor.products.length, 0), onOpen: () => push({ page: "vendor", key: vendor.key }),
        action: <button type="button" data-bundle-open={vendor.key} onClick={() => push({ page: "vendor", key: vendor.key })} aria-label={t("connectApps.featured.seeProducts")} title={t("connectApps.featured.seeProducts")} className={cn(PLUGINS.fillPill, "size-8 px-0")}><ChevronRight size={16} aria-hidden="true" /></button>,
      };
    }) : [];
  // the filter of Discover: the categories of the chosen kind, in a menu
  const filterControl = tab === "discover" ? (
    <DiscoverFilter
      chips={filterChips([
        ...discoverItems(scopedItems, state.pluginsFocusApps ?? undefined).filter((item) => kindOf(item) === kind),
        ...(kind === "connectors" ? accountSections.flatMap((section) => section.rows) : []),
      ], filter)}
      filter={filter}
      onPick={(chip) => { setFilter(chip); setType("any"); }}
      label={(chip) => filterLabel(chip, pluginSourceLabel)}
    />
  ) : undefined;

  // #4453: the count on each kind's tab, what the person has of it in the
  // chosen scope (the rows Yours lists)
  const privateSkillRows = scope === "bot" ? [] : privateSkills(items);
  const kindCounts: Record<ConnectAppsKind, number> = scope === "bot"
    ? (botCapabilities.data ? countKinds(visibleCapabilities(botCapabilities.data.items), kindOf) : { skills: 0, connectors: 0, plugins: 0 })
    : (() => {
      const counts = countKinds(entries, entryKind);
      counts.skills += privateSkillRows.length;
      counts.connectors += accountSections.reduce((sum, section) => sum + section.rows.length, 0) + (personalHere ? personal.rows.length + products.products.length : 0);
      return counts;
    })();
  // what Discover lists, and the cards just added, which stay where they are with their Added state for a moment
  const discoverRows = (() => {
    const open = new Set(discoverItems(scopedItems, state.pluginsFocusApps ?? undefined).map((item) => item.key));
    return scopedItems.flatMap((item): PluginItem[] => open.has(item.key) ? [item] : item.installed && justAdded.has(item.id) ? [{ ...item, justAdded: true }] : []);
  })();
  const yoursLoaded = scope === "bot" ? botCapabilities.data !== null : mcp.servers !== null && skills !== null && (scope === "workspace" || scopedPluginView !== null);
  // #4453: the window opens on Yours when the person has something of the
  // kind here, else on Discover; a view the person chose stays
  useEffect(() => {
    if (viewChosen.current || !yoursLoaded || page.page !== "main") return;
    viewChosen.current = true;
    if (tab === "installed" && kindCounts[kind] === 0) setTab("discover");
  });

  // A failed update is said on the row that failed when that row is on screen
  // (the kind's Yours list); else at the top of the window, as before.
  const rowKeys = (kind === undefined ? entries : entries.filter((entry) => entryKind(entry) === kind)).flatMap((entry) => entry.members.map((member) => member.updateKey))
    .concat(kind === "skills" || kind === undefined ? privateSkillRows.map((skill) => skill.updateKey) : []);
  const failureHasRow = (key: string) => tab === "installed" && page.page === "main" && scope !== "bot" && rowKeys.includes(key);
  const rowNotice = (keys: ReadonlyArray<string | undefined>) => updates.failures.filter((failure) => keys.includes(failure.key)).map((failure) => (
    <UpdateNotice key={failure.key} inline failure={failure} onClose={() => updates.dismissFailure(failure.key)}
      onRetry={() => { updates.dismissFailure(failure.key); void updates.update([failure.key]); }} />
  ));
  const notices = (
    <>
      {panelError && <div role="alert" className="mx-6 mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger sm:mx-8">{panelError}</div>}
      {updates.failures.filter((failure) => !failureHasRow(failure.key)).map((failure) => (
        <UpdateNotice key={failure.key} failure={failure} onClose={() => updates.dismissFailure(failure.key)}
          onRetry={() => { updates.dismissFailure(failure.key); void updates.update([failure.key]); }} />
      ))}
      {panelNotice && <div role="status" className="mx-6 mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning sm:mx-8">{panelNotice}</div>}
      <SavedKeysResetNotice panel />
    </>
  );

  return (
    <PluginsPanelFrame
      dialogRef={dialogRef}
      page={page}
      scope={scope}
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
          kind={kind}
          onKind={setKind}
          home={s.homeView}
          kindCounts={kindCounts}
          botName={scope === "bot" ? scopeBot?.name : undefined}
          filterControl={filterControl}
          sortControl={<SortControl sort={sort} onSort={setSort} options={tab === "discover" ? ["default", "name"] : (updates.data?.count ?? 0) > 0 ? ["default", "name", "on", "update"] : ["default", "name", "on"]} />}
          updateControl={<UpdateAllPill count={updates.data?.count ?? 0} running={updates.updatingAll} onUpdateAll={() => void updates.updateAll()} />}
          scopeNote={scopeControl}
          manageActions={addActions.length > 0 ? <AddMenu actions={addActions} filled /> : undefined}
          search={searchField}
          results={searchResults}
          notices={notices}
          // the one refresh (#2104): plugins, servers, skills, and the engine
          // accounts' connectors, together
          refreshing={refreshing || harness.loading}
          onRefresh={() => { refreshAll(); void harness.load(true); if (personalHere) { void personal.refresh(); void products.refresh(); } }}
          installed={(
            <InstalledView
              sort={sort}
              rowNotice={rowNotice}
              hasUpdate={(kind, name, key) => Boolean(updateOf(updates.data, kind, name, key))}
              loading={mcp.servers === null}
              kind={kind}
              entries={entries}
              grouped={groupedKeys}
              personal={personalHere ? personal.rows : undefined}
              products={consoleRows}
              consoleTitle={consoleTitle ?? undefined}
              consoleHasExtras={scope === "me" && orgCapabilitiesOfForms(orgMine, declarationForms(kind)).length > 0}
              consoleCount={scope === "me" ? orgCapabilitiesOfForms(orgMine, declarationForms(kind)).length : 0}
              consoleExtras={scope === "me" ? (after) => <OrgCapabilitiesForMe key={orgRevision ?? ""} bare state={orgMine} forms={declarationForms(kind)} onOpen={(item) => push({ page: "orgItem", id: item.id })} after={after} /> : undefined}
              entryTrailer={entryTrailer}
              skillTrailer={skillTrailer}
              readOnlyReason={scope === "bot" && botView && !botView.canChange ? t("plugins.readOnly") : undefined}
              resolved={scope === "bot" ? botCapabilities.data : undefined}
              resolvedError={scope === "bot" && !botCapabilities.data ? botCapabilities.error : null}
              onRetryResolved={() => void botCapabilities.reload()}
              removingSuperseded={botBusy}
              onRemoveSuperseded={scope === "bot" && scopedPluginView?.canChange ? removeSuperseded : undefined}
              onToggleOrganization={(item, next) => {
                if (!item.orgDeclaration) return;
                void setMine(item.orgDeclaration, next).then(() => botCapabilities.reload(), (failure) => setPanelError(readableError(failure)));
              }}
              onToggleBotSwitch={scope === "bot" && scopeBot ? (item, next) => {
                const patch = botSwitchPatch(scopeBot, item, next);
                if (!patch) return;
                dispatch({ type: "updateBot", botId: scopeBot.id, patch });
                // the resolver reads the saved bot: refresh once the patch landed
                void flushBotPatches(scopeBot.id).then(() => botCapabilities.reload(), (failure) => setPanelError(readableError(failure)));
              } : undefined}
              onToggleBotServer={scope === "bot" && scopeBot ? (item, next) => {
                const name = installationServerName(item);
                if (!name || !toggleBotServerNames(scopeBot.id, [name], next)) return;
                void flushBotPatches(scopeBot.id).then(() => botCapabilities.reload(), (failure) => setPanelError(readableError(failure)));
              } : undefined}
              botName={scopeBot?.name}
              organization={scope === "bot" && botCapabilities.data ? organizationRows(botCapabilities.data.items) : []}
              skills={privateSkillRows}
              sourceLabel={pluginSourceLabel}
              onOpenEntry={(entry) => openItem(entry.primary)}
              onOpenSkill={openItem}
              entryActions={entryActions}
              // one "+ Add" menu (#2104), in the title bar (#4453: by kind)
              add={addActions}
              addInTitle
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
              forms={kind !== "connectors" ? undefined
                : scope === "workspace" || (scope === "me" && !personalHere) ? (
                <>
                  {/* lot 4: the organization's declarations, owned by Perspicax */}
                  {mcp.restricted && mcp.policy && <p role="status" className="mb-3 text-[13px] leading-relaxed text-ink-secondary">{t("policy.mcpRestricted", { organization: mcp.policy.organizationName })}</p>}
                  <McpMessages mcp={mcp} />
                  <McpReservedServers mcp={mcp} />
                  <McpImportForm mcp={mcp} />
                  {mcp.editing === "new" && <div className="mb-4"><McpServerEditor mcp={mcp} /></div>}
                </>
              ) : personalHere ? (
                <>
                  {personal.forms}
                </>
              ) : undefined}
            />
          )}
          discover={(
            <DiscoverView
              sort={sort}
              vendorSlides={vendorSlides}
              connectorProducts={kind === "connectors" && consoleTitle ? { title: consoleTitle, rows: consoleRows } : undefined}
              bundleCards={bundleCards}
              kind={kind}
              items={discoverRows}
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
                  officialErrors={marketRoute === "workspace" ? officialErrors : undefined}
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
            />
          )}
        />
      )}
    />
  );
}

function PluginsPanelFrame({
  dialogRef, page, scope, stackDepth, close, content, dataCenterFor, setDataCenterFor, installFeatured,
}: {
  dialogRef: PluginsPanelState["dialogRef"];
  page: PluginsPanelState["page"];
  /** where the window works: the bot it was opened from, or the person's own (no control for it, #4453) */
  scope: PluginsPanelState["scope"];
  stackDepth: number;
  close: () => void;
  content: ReactNode;
  dataCenterFor: PluginsPanelState["dataCenterFor"];
  setDataCenterFor: PluginsPanelState["setDataCenterFor"];
  installFeatured: PluginsPanelActions["installFeatured"];
}) {
  const dataCenterAnchor = useRef<HTMLElement | null>(null);
  dataCenterAnchor.current = dataCenterFor?.anchor ?? null;
  const dataCenter = dataCenterFor && (
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
  );

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
        data-plugins-scope={scope}
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
      {dataCenter}
    </div>
  );
}


