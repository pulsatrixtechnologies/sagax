import { groupByVendor } from "@/lib/capability-kinds";
import { VendorPage } from "../plugins/VendorPage";
import type { ProductRowsContext } from "../plugins/ProductRows";
import { updateKindOf, type CapabilityUpdateItem, type UpdateKind } from "@/lib/capability-updates";
import { useEffect, type ReactNode } from "react";
import type { RowState } from "../plugins/StateIcon";
import { Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { detailIdentity } from "@/lib/installed-model";
import { botPluginState } from "@/lib/plugin-scope";
import { fetchBotTailscale } from "@/lib/bot-tailscale";
import type { SkillsLibrarySkillWire } from "../../../shared/wire";
import { TailscaleConnectView } from "../plugins/TailscaleConnectView";
import type { Crumb } from "../Breadcrumb";
import { connectAppsKindLabel, connectAppsTabLabel, type ConnectAppsTab } from "../plugins/ConnectAppsView";
import type { ConnectAppsKind } from "@/lib/capability-kinds";
import { PluginCard, PluginPageHeader } from "../plugins/PluginParts";
import { PluginDetailView } from "../plugins/PluginDetailView";
import { SkillPage } from "../plugins/SkillPage";
import { BotsForView } from "../plugins/BotsForView";
import { MessagesSetupView } from "../plugins/MessagesSetupView";
import { MacAppSetupView, macAppTitle } from "../plugins/MacAppSetupView";
import { CustomConnectorPage } from "../plugins/CustomConnectorPage";
import { ProductDetailView } from "../plugins/ProductDetailView";
import { OrgItemPage } from "../plugins/OrgItemPage";
import { AccountConnectorPage } from "../plugins/AccountConnectorPage";
import type { AccountConnectorRow } from "../plugins/HarnessConnectorGroups";
import type { MemberOrgCapability } from "@/lib/org-capabilities";
import type { PersonProduct } from "@/lib/person-products";
import { detailProps } from "./detailBuilders";
import { pluginSourceLabel, skillReadOnlyReason } from "./helpers";
import type { Page } from "./types";
import type { PluginsPanelState } from "./usePluginsPanelState";
import type { PluginsPanelActions } from "./usePluginsPanelActions";
import type { InstalledEntry } from "@/lib/installed-model";
import type { PluginItem } from "@/lib/plugins-model";

export function PluginsPanelSubpage({
  s,
  a,
  trail,
  entries,
  botsForEntry,
  botsForRows,
  toggleBotServers,
  products,
  updateInfo,
  lastUpdateInfo,
  productCtx,
  itemUpdate,
  orgItems,
  consoleName,
  vendorSkills,
  vendorPlugins,
  accountRows,
}: {
  /** the marketplace plugins installed for a product group (lib/product-plugins): their rows on its page, whether one is off, their state; none: undefined */
  vendorPlugins?: (vendorKey: string) => { rows: ReadonlyArray<{ key: string; node: ReactNode }>; off?: boolean; state?: RowState | null } | undefined;
  /** #4504: the update a skill has, with its Update (running while it runs), for its page */
  itemUpdate?: (kind: UpdateKind, name: string, updateKey?: string) => { from?: string; to?: string; notes?: string; running: boolean; onUpdate?: () => void } | undefined;
  /** what the organization offers or requires of the person (an item that is on opens its page) */
  orgItems?: readonly MemberOrgCapability[];
  /** the connectors the engine accounts brought (a card of Discover or Yours opens one's page) */
  accountRows?: readonly AccountConnectorRow[];
  /** the console's name ("Perspicax · <organization>") for a bundle's grey line */
  consoleName?: string;
  /** a product group's skills: the console's for the vendor, then its plugins' (its Skills tab and every count of them); none: no tab */
  vendorSkills?: (vendorKey: string) => ReadonlyArray<{ name: string; description: string }>;
  /** what the product rows need (the person's bots and the one write): the vendor's page draws the same rows */
  productCtx?: ProductRowsContext;
  /** #4504: the update an item has (its kind and readable name), for its page's versions and notes */
  /** the last update an item had, from the history the server keeps (#4504) */
  lastUpdateInfo?: (kind: UpdateKind, name: string) => { at: number; from?: string; to?: string } | undefined;
  updateInfo?: (kind: UpdateKind, name: string, updateKey?: string, organizationId?: string) => CapabilityUpdateItem | undefined;
  /** #4185: the person's Perspicax products (rows of Installed) */
  products: { products: PersonProduct[]; replace: (product: PersonProduct) => void };
  s: PluginsPanelState;
  a: PluginsPanelActions;
  trail: Crumb[];
  entries: InstalledEntry[];
  botsForEntry: InstalledEntry | undefined;
  botsForRows: (entry: InstalledEntry) => Array<{ id: string; name: string; on: boolean }>;
  toggleBotServers: (entry: InstalledEntry, botId: string, on: boolean) => void;
}): ReactNode {
  const {
    page, skills, skillsRoute, scope,
    back, setStack, loadSkills, items, mcp, mcpAccountDraft, setMcpAccountDraft,
    shownMarketplaces, installing,
  } = s;
  const {
    githubSection, openGithub, githubKey, openItem, uninstallPlugin, updatePlugin, botCard,
    detailHead, engineInfo, setTailscaleView,
  } = a;

  const detailItem = page.page === "detail" ? items.find((item) => item.key === page.key) : undefined;
  // An item that went away (uninstalled, or removed elsewhere) leaves its page.
  const detailMissing = page.page === "detail" && !detailItem && mcp.servers !== null && skills !== null && shownMarketplaces !== null;
  // A skill deleted or renamed elsewhere leaves its page too.
  const skillMissing = page.page === "skill" && Boolean(page.name) && skills !== null && !skills.some((entry) => entry.name === page.name);
  // An entry removed while its "For which bots" is open leaves it too.
  const botsForMissing = page.page === "botsFor" && !botsForEntry && mcp.servers !== null && shownMarketplaces !== null;
  // #4185: a product no longer served to the person leaves its page too.
  const productMissing = page.page === "product" && !products.products.some((entry) => entry.id === page.id);
  // an organization item that is no longer on for the person leaves its page too
  const orgItemMissing = page.page === "orgItem" && orgItems !== undefined && orgItems.length > 0 && !orgItems.some((entry) => entry.id === page.id && entry.on);
  useEffect(() => {
    if (detailMissing || skillMissing || botsForMissing || productMissing || orgItemMissing) back();
  }, [detailMissing, skillMissing, botsForMissing, productMissing, orgItemMissing, back]);
  // The GitHub page opened before the marketplaces answered: the GitHub
  // plugin's page, once it is known.
  const githubLate = page.page === "github" && githubKey !== null;
  useEffect(() => {
    if (!githubLate || !githubKey) return;
    setStack((current) => current[current.length - 1]?.page === "github" ? [...current.slice(0, -1), { page: "detail", key: githubKey }] : current);
  }, [githubLate, githubKey, setStack]);

  const pageSkill = page.page === "skill" && page.name ? skills?.find((entry) => entry.name === page.name) : undefined;
  const skillReadOnly = (skill: SkillsLibrarySkillWire): string | undefined => skillReadOnlyReason(s, skill);


  // A page opened from a tab (2026-10-28): inside that tab's panel, under
  // the title, scope and tabs. Browse Bots is the Bots tab, a pane of its
  // own (#2104).
  if (page.page === "skill" && (pageSkill || !page.name)) {
    return (
      <SkillPage
        key={`${scope}:${page.name ?? "new"}`}
        basePath={skillsRoute}
        skill={pageSkill}
        readOnlyReason={pageSkill ? skillReadOnly(pageSkill) : undefined}
        sourceLabel={pageSkill ? (/^(local|local-import|upload:|learn:)/.test(pageSkill.source) ? t("connectApps.origin.you") : pluginSourceLabel(pageSkill.source)) : undefined}
        update={pageSkill ? itemUpdate?.("skill", pageSkill.name, items.find((entry) => entry.kind === "skill" && entry.id === pageSkill.name)?.updateKey) : undefined}
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
  }
  if (page.page === "botsFor" && botsForEntry) {
    return (
      <BotsForView
        name={botsForEntry.name}
        bots={botsForRows(botsForEntry)}
        onToggle={(botId, on) => toggleBotServers(botsForEntry, botId, on)}
        onBack={back}
        trail={trail}
      />
    );
  }
  if (page.page === "github") {
    return (
      <>
        <PluginPageHeader title={t("myConnections.github.title")} trail={trail} onBack={back} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-3 sm:px-8" data-plugins-github-page>
          {githubSection ? <PluginCard>{githubSection}</PluginCard> : <p className="rounded-xl bg-inset px-4 py-3 text-[13px] text-ink-secondary">{t("connectApps.manage.accountsEmpty")}</p>}
        </div>
      </>
    );
  }
  if (page.page === "product") {
    const product = products.products.find((entry) => entry.id === page.id);
    if (product) return <ProductDetailView key={product.id} product={product} onChanged={products.replace} onBack={back} trail={trail} />;
  }
  if (page.page === "orgItem") {
    const item = orgItems?.find((entry) => entry.id === page.id);
    if (item) return <OrgItemPage key={item.id} item={item} consoleName={consoleName} onBack={back} trail={trail} outdated={Boolean(updateInfo?.(item.form === "skill" ? "skill" : "plugin", item.name, undefined, item.id))} />;
  }
  if (page.page === "vendor" && productCtx) {
    const vendor = groupByVendor(products.products).find((entry) => entry.key === page.key);
    if (vendor) return <VendorPage initialTab={page.connectors ? "connectors" : "overview"} vendor={vendor} ctx={productCtx} onBack={back} trail={trail} consoleName={consoleName} skills={vendorSkills?.(vendor.key)} plugins={vendorPlugins?.(vendor.key)} />;
  }
  if (page.page === "account") {
    const row = accountRows?.find((entry) => entry.key === page.key);
    if (row) return <AccountConnectorPage key={row.key} row={row} onBack={back} trail={trail} />;
  }
  if (page.page === "connector") {
    return <CustomConnectorPage mcp={mcp} onBack={back} trail={trail} />;
  }
  if (page.page === "mac-messages") {
    return <MessagesSetupView onBack={back} trail={trail} />;
  }
  if (page.page === "mac-app") {
    return <MacAppSetupView app={page.app} onBack={back} trail={trail} />;
  }
  if (page.page === "tailscale") {
    return (
      <TailscaleConnectView
        trail={trail}
        onBack={() => {
          back();
          void fetchBotTailscale().then(setTailscaleView).catch(() => undefined);
        }}
      />
    );
  }
  if (page.page === "detail" && detailItem) {
    const identity = detailIdentity(detailItem, entries);
    const run = itemUpdate?.(updateKindOf(detailItem.kind), detailItem.name, detailItem.updateKey);
    const base = detailProps(detailItem, {
      mcp, mcpAccountDraft, setMcpAccountDraft, openGithub, githubKey, githubSection,
      items, marketplaces: shownMarketplaces, installing, openItem,
      uninstallPlugin: (item) => void uninstallPlugin(item),
      updatePlugin: (item) => void updatePlugin(item),
      scope, scopeBotId: s.scopeBotId, botCard: botCard(detailItem, Boolean(run?.onUpdate)),
      contentsOf: (pluginId) => {
        const known = botPluginState(scope === "me" ? s.personalView : scope === "bot" ? s.botView : null, pluginId);
        return known ? { skills: known.contents?.skills ?? [], agents: known.contents?.agents ?? [], commands: known.contents?.commands ?? [], servers: known.installed?.declaredMcpServers ?? [] } : undefined;
      },
    });
    const engines = engineInfo(detailItem);
    // the versions (from, to) and the notes when the source gives them: said once, in the Overview
    const upd = updateInfo?.(updateKindOf(detailItem.kind), detailItem.name, detailItem.updateKey);
    const updateWaiting = upd ? { from: upd.installedVersion, to: upd.availableVersion, notes: upd.updateNotes } : detailItem.updateAvailable ? { from: detailItem.installedVersion, to: detailItem.version } : undefined;
    const { reinstall, ...head } = detailHead(detailItem);
    return (
      <PluginDetailView
        {...base}
        {...(!base.onUpdate && run?.onUpdate ? { onUpdate: run.onUpdate, updating: run.running } : !base.onUpdate && reinstall ? reinstall : {})}
        details={[...base.details, ...(engines.row ? [engines.row] : [])]}
        update={updateWaiting}
        lastUpdate={updateWaiting ? undefined : lastUpdateInfo?.(updateKindOf(detailItem.kind), detailItem.name)}
        notice={engines.notice}
        {...head}
        displayName={identity.name}
        icon={identity.icon}
        onBack={back}
        trail={trail}
      />
    );
  }
  if (page.page === "detail" || page.page === "skill" || page.page === "botsFor") {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary">
        <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
      </div>
    );
  }
  return null;
}

export function pageLabel(entry: Page, tab: ConnectAppsTab, items: readonly PluginItem[], entries: InstalledEntry[], products: readonly PersonProduct[] = [], kind?: ConnectAppsKind, orgItems: readonly MemberOrgCapability[] = [], accountRows: readonly AccountConnectorRow[] = []): string {
  switch (entry.page) {
    // #4453: a page opened from Yours or Discover names its kind ("Plugins")
    case "main": return kind && (tab === "installed" || tab === "discover") ? connectAppsKindLabel(kind) : connectAppsTabLabel(tab);
    case "botsFor": return t("connectApps.entry.bots");
    case "detail": {
      const item = items.find((candidate) => candidate.key === entry.key);
      return item ? detailIdentity(item, entries).name : t("connectApps.back");
    }
    case "skill": return entry.name ?? t("connectApps.skill.new");
    case "github": return t("myConnections.github.title");
    case "mac-messages": return t("connectApps.mac.messages.rowTitle");
    case "mac-app": return macAppTitle(entry.app);
    case "connector": return t("connectApps.addCustomConnector");
    case "tailscale": return t("connectApps.tailscale.title");
    case "product": return products.find((product) => product.id === entry.id)?.name ?? t("connectApps.back");
    case "orgItem": return orgItems.find((item) => item.id === entry.id)?.name ?? t("connectApps.back");
    case "vendor": return groupByVendor(products).find((vendor) => vendor.key === entry.key)?.name ?? t("connectApps.back");
    case "account": return accountRows.find((row) => row.key === entry.key)?.name ?? t("connectApps.back");
  }
}
