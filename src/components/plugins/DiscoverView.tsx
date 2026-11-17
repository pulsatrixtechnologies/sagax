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
import { ArrowRight, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

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
/** How many curated picks the featured set holds (a few, not all). */
const FEATURED_PICKS = 3;

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
  /** one slide per vendor the organization console offers the person (Connectors) */
  vendorSlides?: ReadonlyArray<{ key: string; consoleName: string; name: string; line: string; art: ReactNode; onGo: () => void }>;
  /** the sort chosen in the control row; "name" orders each section by name */
  sort?: ConnectAppsSort;
}

export function DiscoverView({ items: allItems, loading = false, catalogPending = false, filter, onFilter, type, onType, sourceLabel, extraSources = [], focus, onOpenItem, renderAction, renderBelow, kind, accounts: allAccounts = [], onOpenAccount, accountsRefreshing, onAccountsRefresh, onAccountsSetUp, onAddCustom: addCustom, owned = [], canConnect, recommendFrom: allRecommendFrom, sort = "default", vendorSlides = [] }: DiscoverViewProps) {
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
  // the featured set: a few curated picks, and one slide per vendor the
  // console offers; nothing to feature, no block; the shelf does not repeat a pick
  const featuredPicks = !single && !listsPicks ? recommended.filter((row) => row.item.action !== null).slice(0, FEATURED_PICKS) : [];
  const slides: FeaturedSlide[] = [
    ...featuredPicks.map(({ item, pick }): FeaturedSlide => ({
      key: item.key, itemKey: item.key, source: t("connectApps.featured.from", { source: sourceLabel(item.source) }), name: item.name, line: t(PICK_WHY[pick.kind]),
      art: <PluginIcon item={item} faviconSize={256} className="size-20 rounded-2xl" />, action: renderAction(item, "banner"),
    })),
    ...(connectors && !single && !listsPicks ? vendorSlides : []).map((vendor): FeaturedSlide => ({
      key: vendor.key, source: t("connectApps.featured.fromConsole", { console: vendor.consoleName }), name: vendor.name, line: vendor.line,
      art: vendor.art, action: (
        <button type="button" data-featured-vendor-go={vendor.key} onClick={vendor.onGo} className={cn(PLUGINS.fillPill, "h-8")}>{t("connectApps.featured.seeProducts")}</button>
      ),
    })),
  ];
  const featuredKeys = new Set(featuredPicks.map((row) => row.item.key));
  const shelf = recommended.filter((row) => !featuredKeys.has(row.item.key));
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
      {slides.length > 0 && <FeaturedCarousel slides={slides} />}
      {shelf.length > 0 && (
        <section data-plugins-section="recommended" className="mt-[30px] first:mt-4">
          <SectionHead title={sectionTitle({ id: "recommended" })} id="recommended" count={listsPicks ? shelf.length : picks.length - featuredPicks.length} onViewAll={!single && picks.length > recommended.length ? () => onType("recommended") : undefined} />
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

/** A slide of the featured set: a curated pick, or a vendor the organization
 * console offers the person (its name, logo and line come from the console's
 * data, never from this code). */
export interface FeaturedSlide {
  key: string;
  /** the small line over the name ("From <source>") */
  source: string;
  name: string;
  line: string;
  /** the artwork at the right: an SVG or the largest image there is */
  art: ReactNode;
  action: ReactNode;
  /** a curated pick's row key, so the shelf does not repeat it */
  itemKey?: string;
}

const SLIDE_MS = 6000;

/** The featured block of Discover (#4453): one wide rounded card that cycles
 * through its slides by itself every few seconds, pauses on hover and on
 * keyboard focus, never moves by itself under the system's reduced-motion
 * setting, has dots to jump to a slide and previous/next buttons the keyboard
 * reaches. One slide is visible at a time. */
export function FeaturedCarousel({ slides }: { slides: readonly FeaturedSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const current = slides[Math.min(index, Math.max(count - 1, 0))];
  const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);
  useEffect(() => {
    if (count < 2 || paused || reduced) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % count), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [count, index, paused, reduced]);
  if (!current) return null;
  const go = (next: number) => setIndex((next + count) % count);
  return (
    <section data-plugins-section="featured" data-featured-banner="" data-plugin-row={current.itemKey ?? current.key}
      aria-roledescription="carousel" aria-label={t("connectApps.featured.aria")}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); }}
      className="relative mt-4 overflow-hidden rounded-2xl border-[0.5px] border-ink/[0.1] bg-gradient-to-br from-ink/[0.07] to-ink/[0.02] p-5 pb-9">
      <div role="group" aria-roledescription="slide" aria-label={`${Math.min(index, count - 1) + 1} / ${count}`} aria-live={paused || count < 2 ? "polite" : "off"} data-featured-slide={current.key} className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] leading-4 text-ink-secondary" data-featured-source="">{current.source}</p>
          <h3 className="mt-1 truncate text-[18px] font-normal leading-7 text-ink">{current.name}</h3>
          <p className="mt-0.5 line-clamp-1 text-[13px] leading-[18px] text-ink-secondary" title={current.line}>{current.line}</p>
          <div className="mt-3 flex items-center gap-2">{current.action}</div>
        </div>
        <div className="flex size-20 shrink-0 items-center justify-center max-sm:hidden" aria-hidden="true" data-featured-art="">{current.art}</div>
      </div>
      {count > 1 && (
        <div className="absolute inset-x-5 bottom-2.5 flex items-center justify-between" data-featured-controls="">
          <div className="flex items-center gap-1.5" role="group" aria-label={t("connectApps.featured.dots")}>
            {slides.map((slide, position) => (
              <button key={slide.key} type="button" data-featured-dot={position} aria-label={t("connectApps.featured.goTo", { name: slide.name })} aria-current={position === index ? "true" : undefined}
                onClick={() => go(position)} className={cn("size-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong motion-reduce:transition-none", position === index ? "bg-ink" : "bg-ink/25 hover:bg-ink/50")} />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-featured-prev="" aria-label={t("connectApps.featured.prev")} title={t("connectApps.featured.prev")} onClick={() => go(index - 1)} className="inline-flex size-6 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"><ChevronLeft size={14} aria-hidden="true" /></button>
            <button type="button" data-featured-next="" aria-label={t("connectApps.featured.next")} title={t("connectApps.featured.next")} onClick={() => go(index + 1)} className="inline-flex size-6 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"><ChevronRight size={14} aria-hidden="true" /></button>
          </div>
        </div>
      )}
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
