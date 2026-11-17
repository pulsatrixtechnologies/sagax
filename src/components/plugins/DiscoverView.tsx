// Connect apps > Discover, the view a person lands on (2026-10-27: the
// former home page and Manage's Discover made one): the catalog of apps,
// plugins and skills that can still be added, the category pills (no Browse
// Bots button since 2026-10-29: the Bots tab is its place), then the sections in
// two columns. View all filters this view in place. The search is Connect
// Apps' one search above the tabs (2026-10-29: one option, one place). The apps a conversation needs (its Connect
// apps pill) come first. What is installed lives in Installed; the engines'
// connectors in Installed (Providers). Recommended for you comes first, under
// the pills (#4207): the curated picks a bot usually wants
// (recommended-picks.ts) that this person can connect and does not have.
// #4453: Discover of one kind (Skills, Connectors or Plugins); "From Sagax"
// left the home, it repeated Yours.
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { kindOf, type ConnectAppsKind } from "@/lib/capability-kinds";
import { mainSections, SECTION_PREVIEW, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import { PICK_WHY, recommendedPicks } from "@/lib/recommended-picks";
import { CARD_GRID, ConnectedMark, DiscoverCard, filterLabel, sectionTitle, sortRows, type ConnectAppsSort } from "./ConnectAppsView";
import { PluginIcon } from "./PluginParts";
import { PLUGINS } from "./plugins-style";
import { AccountConnectorBody, AccountConnectorStatus, AccountNoticeRow, accountRowMatches, openAccountManage, type AccountConnectorRow, type HarnessConnectorGroup, type HarnessEngine } from "./HarnessConnectorGroups";

const PAGE = 60;

export interface DiscoverViewProps {
  /** rows not installed yet (discoverItems) */
  items: PluginItem[];
  loading?: boolean;
  /** the catalog has not answered and nothing is cached: skeleton rows */
  catalogPending?: boolean;
  filter: PluginFilter;
  onFilter: (filter: PluginFilter) => void;
  type: PluginTypeFilter;
  onType: (type: PluginTypeFilter) => void;
  sourceLabel: (source: string) => string;
  /** marketplaces: a section of their own */
  extraSources?: string[];
  /** apps a conversation needs (its Connect apps pill): shown first */
  focus?: readonly string[];
  onOpenItem: (item: PluginItem) => void;
  /** a row's button; the banner asks for the labelled one */
  renderAction: (item: PluginItem, variant?: "card" | "banner") => ReactNode;
  renderBelow?: (item: PluginItem) => ReactNode;
  /** #4453: the one kind shown; absent: every kind */
  kind?: ConnectAppsKind;
  /** "From <provider>" (#2306): the engine accounts' connectors, in their
   * rows (Connectors only); Manage on <provider> is the section's link */
  accounts?: ReadonlyArray<{ group: HarnessConnectorGroup; rows: AccountConnectorRow[] }>;
  /** an account row with a page of its own (a Grok connector); absent: none */
  onOpenAccount?: (row: AccountConnectorRow) => (() => void) | undefined;
  accountsRefreshing?: boolean;
  onAccountsRefresh?: () => void;
  onAccountsSetUp?: (engine: HarnessEngine) => void;
  /** the centred "Add a custom connector" at the end */
  onAddCustom?: () => void;
  /** names of what the person already has, in any scope (Recommended for
   * you leaves them out, and their kind) */
  owned?: readonly string[];
  /** whether this person can connect a row here (Recommended for you hides
   * the others); absent: a row with an action */
  canConnect?: (item: PluginItem) => boolean;
  /** where Recommended for you picks from, when it is wider than `items`
   * (Me: the catalog's apps too); absent: `items` */
  recommendFrom?: readonly PluginItem[];
  /** the sort chosen in the control row; "name" orders each section by name */
  sort?: ConnectAppsSort;
}

export function DiscoverView({ items: allItems, loading = false, catalogPending = false, filter, onFilter, type, onType, sourceLabel, extraSources = [], focus, onOpenItem, renderAction, renderBelow, kind, accounts: allAccounts = [], onOpenAccount, accountsRefreshing, onAccountsRefresh, onAccountsSetUp, onAddCustom: addCustom, owned = [], canConnect, recommendFrom: allRecommendFrom, sort = "default" }: DiscoverViewProps) {
  // #4453: the kind tab says what is listed (the type filter's apps, MCP
  // servers or skills); the engine accounts and the custom connector are
  // connectors
  const ofKind = (rows: readonly PluginItem[]) => (kind === undefined ? [...rows] : rows.filter((item) => kindOf(item) === kind));
  const items = ofKind(allItems);
  const recommendFrom = allRecommendFrom ? ofKind(allRecommendFrom) : undefined;
  const connectors = kind === undefined || kind === "connectors";
  const accounts = connectors ? allAccounts : [];
  const onAddCustom = connectors ? addCustom : undefined;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [filter, type]);
  const single = filter !== "all" || type !== "any";
  const listsPicks = type === "recommended";
  // Recommended for you (#4207): on All, the first SECTION_PREVIEW picks (the
  // reference's count); its View all lists every pick. An account connector
  // the person has connected counts as theirs, and so does what it reaches.
  // Only a connector that is connected counts: one waiting for a sign-in
  // or failed leaves its kind open.
  const accountOwned = accounts.flatMap(({ rows }) => rows.filter((row) => row.status === "connected"));
  const picks = !single || listsPicks
    ? recommendedPicks(recommendFrom ?? items, { names: [...owned, ...accountOwned.map((row) => row.name)], capabilities: accountOwned.flatMap((row) => row.capabilities) }, canConnect)
    : [];
  const recommended = listsPicks ? picks : picks.slice(0, SECTION_PREVIEW);
  // a banner only when there is something real to feature: the first recommended
  // item (no collection, no carousel); the shelf below does not repeat it
  const banner = !single && !listsPicks && recommended.length > 0 && recommended[0]!.item.action !== null ? recommended[0]! : null;
  const shelf = banner ? recommended.slice(1) : recommended;
  const sections = listsPicks ? [] : mainSections(items, "", filter, type, extraSources, focus, recommended.map((row) => row.item.key));
  // a category or a type keeps the account rows it matches; the notices
  // (no account, nothing read yet) show on All only
  const accountSections = accounts
    .map(({ group, rows }) => ({ group, rows: rows.filter((row) => accountRowMatches(row, filter, type)), notice: !single && group.notice ? group : null }))
    .filter((section) => section.rows.length > 0 || section.notice);
  return (
    <div data-plugins-discover className="[&>section:first-child]:mt-4">
      {type !== "any" && (
        <div className="flex flex-wrap items-center gap-2" data-plugins-chips="">
          <button type="button" aria-pressed data-plugins-type={type} onClick={() => onType("any")} className={cn(PLUGINS.fillPill, "h-7 px-3 text-[13px]")}>
            {filterLabel(type, sourceLabel)} ×
          </button>
        </div>
      )}
      {banner && (
        <FeaturedBanner item={banner.item} sub={t(PICK_WHY[banner.pick.kind])} from={sourceLabel(banner.item.source)} action={renderAction(banner.item, "banner")} onOpen={onOpenItem} />
      )}
      {shelf.length > 0 && (
        <section data-plugins-section="recommended" className="mt-[30px] first:mt-4">
          <SectionHead title={sectionTitle({ id: "recommended" })} id="recommended" count={listsPicks ? shelf.length : picks.length - (banner ? 1 : 0)} onViewAll={!single && picks.length > recommended.length ? () => onType("recommended") : undefined} />
          <div className={CARD_GRID}>
            {shelf.map(({ item, pick }) => (
              <DiscoverCard key={item.key} item={item} sub={t(PICK_WHY[pick.kind])} from={sourceLabel(item.source)} onOpen={onOpenItem} action={renderAction(item)} />
            ))}
          </div>
        </section>
      )}
      {accountSections.map(({ group, rows, notice }) => (
        <section key={group.id} data-plugins-section={`from-${group.id}`} data-harness-group={group.id} className="mt-[30px]">
          <SectionHead title={t("connectApps.section.fromProvider", { provider: group.source })} count={rows.length}
            link={{ label: t("connectApps.providers.manage", { provider: group.name }), onClick: () => openAccountManage(group.manageUrl), manage: group.id }} />
          {group.id === "grok" && rows.length > 0 && <p className={cn(PLUGINS.rowSub, "pl-3")} data-harness-grok-note>{t("connectApps.capabilities.grokOrg")}</p>}
          <div className={CARD_GRID}>
            {notice && <AccountNoticeRow group={notice} refreshing={accountsRefreshing} onRefresh={onAccountsRefresh} onSetUp={onAccountsSetUp} manageInHead />}
            {rows.map((row) => {
              const open = onOpenAccount?.(row);
              const body = <AccountConnectorBody row={row} />;
              return (
                <div key={row.key} data-plugin-row={`account:${row.key}`} data-harness-connector={row.key} data-discover-card="" className="flex min-w-0 items-center gap-3 rounded-2xl border-[0.5px] border-ink/[0.1] bg-ink/[0.015] p-3">
                  {open ? (
                    <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left" aria-label={t("connectApps.openAria", { name: row.name })}>{body}</button>
                  ) : <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>}
                  <AccountConnectorStatus row={row} installedMark={<ConnectedMark />} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {catalogPending && !loading && (
        <div data-plugins-skeleton aria-hidden className="mt-[30px] grid gap-3">
          {[0, 1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-xl bg-card" />)}
        </div>
      )}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-24 text-[12px] text-ink-secondary">
          <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
        </div>
      ) : sections.every((section) => section.items.length === 0) ? (recommended.length > 0 || accountSections.some((section) => section.rows.length > 0) ? null : (
        <div className="mt-6 rounded-xl bg-card px-4 py-3 text-[12px] text-ink-secondary" data-plugins-empty>
          {t("connectApps.discover.empty")}
        </div>
      )) : sections.filter((section) => section.items.length > 0).map((section) => {
        const shown = single ? section.items.slice(0, limit) : section.items;
        return (
          <section key={section.id} data-plugins-section={section.id} className="mt-[30px]">
            <SectionHead
              title={sectionTitle(section, sourceLabel)}
              id={section.id}
              count={section.total}
              onViewAll={!single && section.filter && section.total > section.items.length ? () => {
                const target = section.filter!;
                if ("filter" in target) onFilter(target.filter);
                else onType(target.type);
              } : undefined}
            />
            <div className={CARD_GRID}>
              {sortRows(shown, sort, (item) => item.name, (item) => item.installed).map((item) => (
                <div key={item.key} className="contents">
                  <DiscoverCard item={item} from={sourceLabel(item.source)} onOpen={onOpenItem} action={renderAction(item)} />
                  {renderBelow?.(item)}
                </div>
              ))}
            </div>
            {single && section.items.length > shown.length && (
              <div className="mt-3 flex justify-center">
                <button type="button" onClick={() => setLimit((current) => current + PAGE)} className={PLUGINS.fillPill}>
                  {t("connectApps.showMore", { count: section.items.length - shown.length })}
                </button>
              </div>
            )}
          </section>
        );
      })}
      {onAddCustom && (
        <div className="mt-10 flex justify-center">
          <button type="button" onClick={onAddCustom} className={cn(PLUGINS.fillPill, "h-[37px] px-5 text-[14px]")} data-plugins-add-custom>
            {t("connectApps.addCustomConnector")}
          </button>
        </div>
      )}
    </div>
  );
}

/** The one featured block of Discover (#4453): a wide rounded card with its
 * source line, a large name, one line of description, the item's Install and
 * its artwork at the right. Drawn only when there is something real to feature. */
function FeaturedBanner({ item, sub, from, action, onOpen }: { item: PluginItem; sub: string; from: string; action: ReactNode; onOpen: (item: PluginItem) => void }) {
  return (
    <section data-plugins-section="featured" data-featured-banner="" data-plugin-row={item.key} className="mt-4 flex items-center gap-4 overflow-hidden rounded-2xl border-[0.5px] border-ink/[0.1] bg-gradient-to-br from-ink/[0.07] to-ink/[0.02] p-5">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-4 text-ink-secondary" data-featured-source="">{t("connectApps.featured.from", { source: from })}</p>
        <h3 className="mt-1 truncate text-[18px] font-normal leading-7 text-ink">{item.name}</h3>
        <p className="mt-0.5 line-clamp-1 text-[13px] leading-[18px] text-ink-secondary" title={item.description}>{sub || item.description}</p>
        <div className="mt-3 flex items-center gap-2">
          {action ?? (
            <button type="button" onClick={() => onOpen(item)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink/[0.12] px-3.5 text-[13px] text-ink"><Check size={13} aria-hidden="true" />{t("connectApps.card.added")}</button>
          )}
        </div>
      </div>
      <div className="relative flex shrink-0 items-center justify-center max-sm:hidden" aria-hidden="true" data-featured-art="">
        <PluginIcon item={item} className="size-20 rounded-2xl" />
      </div>
    </section>
  );
}

function SectionHead({ title, id, count, onViewAll, link }: { title: string; id?: string; /** the count in a small rounded badge next to the title */ count?: number; onViewAll?: () => void; link?: { label: string; onClick: () => void; manage: string } }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className={PLUGINS.sectionTitle}>{title}</h3>
        {count !== undefined && count > 0 && <span className="mt-1 rounded-full bg-ink/[0.08] px-2 text-[12px] leading-4 tabular-nums text-ink-secondary" data-section-count={count}>{count}</span>}
      </div>
      {link && (
        <button type="button" data-harness-manage={link.manage} className={PLUGINS.sectionLink} onClick={link.onClick}>
          {link.label}
        </button>
      )}
      {!link && onViewAll && (
        <button type="button" data-plugins-view-all={id ?? ""} className={PLUGINS.sectionLink} onClick={onViewAll}>
          {t("connectApps.viewAll")}<ArrowRight size={12} aria-hidden="true" className="ml-1 inline" />
        </button>
      )}
    </div>
  );
}
