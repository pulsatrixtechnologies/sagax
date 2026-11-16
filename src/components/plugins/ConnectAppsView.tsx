// Connect Apps (#2104, the reference's look; #4453, JC 2026-11-16: "to be
// able to see what are skills, connectors, plugins"). Three kind tabs
// (Skills, Connectors, Plugins), each with Yours (what is here, in the chosen
// scope) and Discover (what can be added); Bot templates, Published pages and
// Sources under the title bar's "...". A page opened from a view (a plugin, a
// skill, a custom connector) takes the whole pane under its own bar. The
// shared row parts (pills, section titles, PluginRow) live here too.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, Check, ChevronLeft, FileText, Library, ListFilter, MoreHorizontal, RefreshCw, Search, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  CATEGORY_ORDER,
  MAIN_CATEGORIES,
  MORE_CATEGORIES,
  type PluginFilter,
  type PluginItem,
  type PluginSection,
  type PluginTypeFilter,
} from "@/lib/plugins-model";
import { CONNECT_APPS_KINDS, type ConnectAppsKind } from "@/lib/capability-kinds";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { MENU_ROW, MENU_ROW_ACTIVE, MENU_SURFACE } from "@/components/menu-look";
import { BackButton } from "../Breadcrumb";
import { ConnectedMark, PluginIcon, PluginStatusLabel } from "./PluginParts";

export { ConnectedMark };
import { PLUGINS } from "./plugins-style";

/** The pills: All, then each category in the section order (only those with
 * a row, and the chosen one). Kinds and sources are not pills. */
export const MAIN_CHIPS: PluginFilter[] = ["all"];
export const CATEGORY_CHIPS: PluginFilter[] = [...CATEGORY_ORDER];
export const TYPE_FILTERS: PluginTypeFilter[] = ["any", "apps", "mcp", "skills"];

const MAIN_CATEGORY_SET = new Set<string>(MAIN_CATEGORIES);
const MORE_CATEGORY_SET = new Set<string>(MORE_CATEGORIES);

/** The pills on the row: All, then the main categories that have a row. */
export function categoryPills(items: readonly Pick<PluginItem, "category">[], filter: PluginFilter): PluginFilter[] {
  const present = new Set<string>(items.map((item) => item.category));
  return [...MAIN_CHIPS, ...CATEGORY_CHIPS.filter((chip) => MAIN_CATEGORY_SET.has(chip) && (present.has(chip) || chip === filter))];
}

/** Categories that sit in the More menu: the ones with a row, or the one
 * that is already chosen. */
export function moreCategoryPills(items: readonly Pick<PluginItem, "category">[], filter: PluginFilter): PluginFilter[] {
  const present = new Set<string>(items.map((item) => item.category));
  return CATEGORY_CHIPS.filter((chip) => MORE_CATEGORY_SET.has(chip) && (present.has(chip) || chip === filter));
}

/** Every category the filter lists: All, then the ones with a row (and the
 * chosen one), main first. */
export function filterChips(items: readonly Pick<PluginItem, "category">[], filter: PluginFilter): PluginFilter[] {
  return [...categoryPills(items, filter), ...moreCategoryPills(items, filter)];
}

const FILTER_KEY: Record<string, LocaleKey> = {
  all: "connectApps.filter.all",
  productivity: "connectApps.filter.productivity",
  communication: "connectApps.filter.communication",
  design: "connectApps.filter.design",
  code: "connectApps.filter.code",
  passwords: "connectApps.filter.passwords",
  data: "connectApps.filter.data",
  sales: "connectApps.filter.sales",
  finance: "connectApps.filter.finance",
  marketing: "connectApps.filter.marketing",
  research: "connectApps.filter.research",
  support: "connectApps.filter.support",
  other: "connectApps.filter.other",
  any: "connectApps.type.any",
  apps: "connectApps.filter.apps",
  mcp: "connectApps.filter.mcp",
  skills: "connectApps.filter.skills",
  recommended: "connectApps.section.recommended",
};

const SECTION_KEY: Record<string, LocaleKey> = {
  ...FILTER_KEY,
  needed: "connectApps.section.needed",
  results: "connectApps.section.results",
  other: "connectApps.section.other",
  mcp: "connectApps.section.mcp",
};

/** A chip's, type's or section's label. A marketplace source is shown by name. */
export function filterLabel(filter: string, sourceLabel?: (source: string) => string): string {
  if (filter.startsWith("source:")) {
    const source = filter.slice("source:".length);
    return sourceLabel?.(source) ?? source;
  }
  return t(FILTER_KEY[filter] ?? "connectApps.filter.other");
}

export function sectionTitle(section: Pick<PluginSection, "id">, sourceLabel?: (source: string) => string): string {
  if (section.id.startsWith("source:")) return filterLabel(section.id, sourceLabel);
  return t(SECTION_KEY[section.id] ?? "connectApps.section.other");
}

export type ConnectAppsTab = "installed" | "discover" | "bots" | "pages" | "sources";

/** A link or shortcut that used to open the Providers tab (2026-10-29: the
 * tab is gone, its rows sit in Installed under their own "Providers"
 * section). The name stays valid in links; it opens Installed on that section. */
export function isProvidersLink(value: string | null | undefined): boolean {
  return value === "providers" || value === "accounts";
}

/** The tab an older name or link points at: "accounts" (My accounts) and
 * "providers" lead to "installed" (see isProvidersLink), Browse Bots' names
 * to "bots"; anything unknown is not a tab. */
export function normalizeConnectAppsTab(value: string | null | undefined): ConnectAppsTab | null {
  if (isProvidersLink(value)) return "installed";
  if (value === "browseBots" || value === "browse-bots" || value === "botCatalog" || value === "templates") return "bots";
  return value === "installed" || value === "discover" || value === "bots" || value === "pages" || value === "sources" ? value : null;
}
/** Plugins (#2104, 2026-11-05, JC's review): five visible tabs, Installed
 * first (what a person has), Discover (the catalog), Bots (Browse Bots),
 * Pages (the published pages) and Sources (where plugins come from), as the
 * Grok Bot reference lays them out (docs/design 2.8). A deep link selects
 * its tab; the tab row never hides. The window has no scope control
 * (#4453, 2026-11-16): each item says where it is on. The one search covers
 * every tab. */
export const CONNECT_APPS_TABS: readonly ConnectAppsTab[] = ["installed", "discover", "bots", "pages", "sources"];
export const SCOPELESS_TABS: readonly ConnectAppsTab[] = ["bots", "pages"];

const TAB_KEY = {
  installed: "connectApps.view.yours",
  discover: "connectApps.manage.tab.discover",
  bots: "connectApps.manage.tab.bots",
  pages: "connectApps.manage.tab.pages",
  sources: "connectApps.manage.tab.sources",
} as const satisfies Record<ConnectAppsTab, LocaleKey>;

/** A tab's name, for the tab itself and the back row of a page opened from it. */
export function connectAppsTabLabel(tab: ConnectAppsTab): string {
  return t(TAB_KEY[tab]);
}

/** An underlined tab (#4453): the reference's tab metrics (13px, 6px between
 * the label and its count, 10px by 5px), the chosen one in the primary ink
 * with a 2px line under it. */
export function kindTabClass(active: boolean): string {
  return cn(
    "relative -mb-px inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-[13px] font-medium leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong motion-reduce:transition-none",
    "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full",
    active ? "text-ink after:bg-ink" : "text-ink-secondary after:bg-transparent hover:text-ink",
  );
}

/** Yours | Discover: the window's one two-position switch, a gray track with
 * a raised chosen segment (the tabs are lines, this is a switch). */
export const SEGMENT_TRACK = "flex w-fit items-center gap-0.5 rounded-full bg-ink/[0.06] p-0.5";
export function segmentTrackOption(active: boolean): string {
  return cn(
    "flex h-6 min-w-0 items-center rounded-full px-3 text-[12px] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong motion-reduce:transition-none",
    active ? "bg-ink/[0.14] font-medium text-ink" : "text-ink-secondary hover:text-ink",
  );
}

/** Below this width of the title line the search is an icon that opens. */
export const SEARCH_ICON_BELOW = 560;

export interface ConnectAppsViewProps {
  tab: ConnectAppsTab;
  onTab: (tab: ConnectAppsTab) => void;
  /** Leave the Connect apps view (content frame back). */
  onBack?: () => void;
  /** views with something to show (Sources only when a source is reachable):
   * the "..." of the title bar opens the ones past Yours and Discover */
  tabs?: readonly ConnectAppsTab[];
  /** #4453: the kind shown (Skills, Connectors, Plugins) and its tabs */
  kind?: ConnectAppsKind;
  onKind?: (kind: ConnectAppsKind) => void;
  /** what the person has of each kind in the chosen scope, on its tab */
  kindCounts?: Partial<Record<ConnectAppsKind, number>>;
  /** where "< Connect Apps" of Bots, Pages and Sources leads: the view the
   * person came from */
  home?: "installed" | "discover";
  /** the bot the window was opened from: the title carries its name */
  botName?: string;
  /** the filter button, Discover only: the categories live in it */
  filterControl?: ReactNode;
  /** what the scope does here, over the list */
  scopeNote?: ReactNode;
  /** the one "+ Add" menu, beside the search */
  manageActions?: ReactNode;
  /** a page opened from a view (a plugin's detail, a skill): the whole pane */
  page?: ReactNode;
  /** the one search (ConnectAppsSearch), beside the kind tabs */
  search?: ReactNode;
  /** what the search found: in place of the list */
  results?: ReactNode;
  /** notices over the open view */
  notices?: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  installed?: ReactNode;
  discover?: ReactNode;
  /** Browse Bots: a pane with its own pages and scroll */
  bots?: ReactNode;
  pages?: ReactNode;
  sources?: ReactNode;
}

const BIG_TITLE_KEY = {
  installed: "connectApps.title",
  discover: "connectApps.title",
  bots: "connectApps.botTemplates",
  pages: "settings.section.pages",
  sources: "connectApps.manage.tab.sources",
} as const satisfies Record<ConnectAppsTab, LocaleKey>;

const KIND_KEY = {
  skills: "connectApps.kind.skills",
  connectors: "connectApps.kind.connectors",
  plugins: "connectApps.kind.plugins",
} as const satisfies Record<ConnectAppsKind, LocaleKey>;

/** A kind's name, on its tab and in a search's "in Skills". */
export function connectAppsKindLabel(kind: ConnectAppsKind): string {
  return t(KIND_KEY[kind]);
}

/** The views under the title bar's "...": Bot templates, Published pages,
 * Sources (#4453: they are none of the three kinds; one home each). */
const MORE_VIEWS: ReadonlyArray<{ id: Extract<ConnectAppsTab, "bots" | "pages" | "sources">; key: LocaleKey; icon: ReactNode }> = [
  { id: "bots", key: "connectApps.botTemplates", icon: <Bot size={14} aria-hidden="true" /> },
  { id: "pages", key: "settings.section.pages", icon: <FileText size={14} aria-hidden="true" /> },
  { id: "sources", key: "connectApps.manage.tab.sources", icon: <Library size={14} aria-hidden="true" /> },
];

/** Connect Apps (#4453, the reference's Customize, JC 2026-11-16): the title
 * and "..." (Bot templates, Published pages, Sources); the three kind tabs
 * (Skills, Connectors, Plugins) with their counts, the one search and the
 * one "+ Add"; Yours or Discover with the refresh, and no scope (it is
 * chosen on each item, #4453); then the list of the chosen kind, which
 * alone scrolls. Bots, Pages and Sources open alone under "< Connect Apps".
 * A page (a plugin, a skill, a custom connector) takes the whole pane under
 * its own bar. */
export function ConnectAppsView(props: ConnectAppsViewProps) {
  const { tab, onTab, onBack, tabs = CONNECT_APPS_TABS, kind = "connectors", onKind, kindCounts, home = "installed", scopeNote, manageActions, search, results, page, notices, refreshing, onRefresh, botName, filterControl } = props;
  const shown = tabs.includes(tab) ? tab : tabs.includes("installed") ? "installed" : tabs[0] ?? "installed";
  const [stuck, setStuck] = useState(false);
  // the title line's width decides the search: a field, or an icon that opens it
  const headRef = useRef<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const head = headRef.current;
    if (!head || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setNarrow(width < SEARCH_ICON_BELOW);
    });
    watch.observe(head);
    return () => watch.disconnect();
  });
  useEffect(() => { if (!narrow) setSearchOpen(false); }, [narrow]);
  // each view opens at its top: the hairline of a scrolled list goes with it
  useEffect(() => setStuck(false), [shown, kind]);

  if (page !== undefined && !results) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={shown} data-plugins-manage={shown} data-plugins-subpage="">
        <h2 id="plugins-title" className="sr-only">{t("connectApps.title")}</h2>
        {notices}
        {page}
      </div>
    );
  }

  if (shown === "installed" || shown === "discover") {
    const moreViews = MORE_VIEWS.filter((view) => tabs.includes(view.id));
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={shown} data-plugins-kind={kind}>
        {/* the title, the kind tabs and the view row stay put: only the list
            scrolls, under a hairline once it moves (#2948) */}
        <div
          className={cn(PLUGINS.gutter, "shrink-0 border-b border-transparent pb-3 pt-[22px]", stuck && "border-hairline-weak")}
          data-plugins-title-row=""
          data-plugins-stuck={stuck ? "" : undefined}
        >
          {/* line 1 (#4453, 2026-11-16, two balanced lines): the title, then
              the search, the filter (Discover only), Add, "..." and the
              close button. Narrow: the search shrinks, then is an icon
              button that opens over the line; it never wraps. */}
          <header ref={headRef} className="relative flex min-h-8 items-center gap-2 pr-9" data-plugins-head="">
            {onBack && <BackButton onBack={onBack} data={{ "data-apps-back": "" }} />}
            <h2 id="plugins-title" className={cn(PLUGINS.title, "min-w-fit flex-1 break-words")}>
              {botName ? t("connectApps.titleForBot", { name: botName }) : t("connectApps.title")}
            </h2>
            {search && !narrow && <div className="min-w-[96px] max-w-[260px] flex-[0_1_260px]" data-plugins-search-slot="">{search}</div>}
            {search && narrow && (
              <button type="button" onClick={() => setSearchOpen(true)} className="ui-icon-button" aria-label={t("connectApps.search.open")} title={t("connectApps.search.open")} data-plugins-search-toggle="">
                <Search size={16} aria-hidden="true" />
              </button>
            )}
            {shown === "discover" && filterControl}
            {manageActions}
            <MoreViewsMenu views={moreViews} onPick={onTab} onRefresh={onRefresh} refreshing={refreshing} />
            {search && narrow && searchOpen && (
              <div className="absolute inset-y-0 left-0 right-9 z-10 flex items-center gap-2 bg-inset" data-plugins-search-slot="" data-plugins-search-expanded="">
                <div className="min-w-0 flex-1">{search}</div>
                <button type="button" onClick={() => setSearchOpen(false)} className="ui-icon-button" aria-label={t("connectApps.search.close")} title={t("connectApps.search.close")} data-plugins-search-close="">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </header>
          {/* line 2: the three kinds as underlined tabs with their counts at
              the left, Yours | Discover alone at the right. No scope here: it
              is chosen on each item. */}
          <div className="mt-3 flex items-end justify-between gap-6 border-b border-hairline-weak" data-plugins-kind-row="">
            <div role="tablist" aria-label={t("connectApps.kind.aria")} className="flex items-end gap-3" data-plugins-kinds="">
              {CONNECT_APPS_KINDS.map((id) => {
                const count = kindCounts?.[id];
                return (
                  <button key={id} type="button" role="tab" aria-selected={kind === id} data-plugins-kind-tab={id}
                    onClick={() => onKind?.(id)} className={kindTabClass(kind === id)}>
                    {connectAppsKindLabel(id)}
                    {count !== undefined && count > 0 && (
                      <span className="text-[12px] tabular-nums text-ink-tertiary" data-plugins-kind-count={count}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div role="radiogroup" aria-label={t("connectApps.view.aria")} className={cn(SEGMENT_TRACK, "mb-1 shrink-0")} data-plugins-views="">
              {(["installed", "discover"] as const).map((id) => (
                <button key={id} type="button" role="radio" aria-checked={shown === id} data-plugins-view={id}
                  onClick={() => onTab(id)} className={segmentTrackOption(shown === id)}>
                  {t(id === "installed" ? "connectApps.view.yours" : "connectApps.manage.tab.discover")}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto outline-none"
          onScroll={(event) => setStuck(event.currentTarget.scrollTop > 4)}
          tabIndex={-1}
          data-plugins-list=""
          data-plugins-manage={shown}
          data-plugins-results={results ? "" : undefined}
        >
          <div className={cn(PLUGINS.gutter, "pb-8")}>
            {scopeNote}
            {notices}
            <div>{results ?? (shown === "installed" ? props.installed : props.discover)}</div>
          </div>
        </div>
      </div>
    );
  }

  const backBar = (
    <div className="flex h-12 shrink-0 items-center px-3 pr-14" data-plugins-manage-bar>
      <button
        type="button"
        onClick={() => onTab(home)}
        className="-ml-0.5 flex h-8 items-center gap-1 rounded-full pl-1 pr-2.5 text-[13px] text-ink hover:bg-hover"
        data-plugins-home=""
        data-breadcrumb-back=""
      >
        <ChevronLeft size={18} aria-hidden="true" />
        {t("connectApps.title")}
      </button>
    </div>
  );
  if (shown === "bots") {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-plugins-main="bots" data-plugins-manage="bots">
        <h2 id="plugins-title" className="sr-only">{t(BIG_TITLE_KEY.bots)}</h2>
        {backBar}
        {notices}
        <div className="flex min-h-0 flex-1 flex-col">{props.bots}</div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={shown}>
      {backBar}
      {/* The title and its pills stay put under the back bar: only the list
          scrolls, under a hairline once it moves (#2948: the title and the
          pills slid under "< Plugins" and were cut). */}
      <div
        className={cn(PLUGINS.gutter, "shrink-0 border-b border-transparent pb-3 pt-3", stuck && "border-hairline-weak")}
        data-plugins-title-row=""
        data-plugins-stuck={stuck ? "" : undefined}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <h2 id="plugins-title" className={cn(PLUGINS.bigTitle, "min-w-0 flex-1")}>{t(BIG_TITLE_KEY[shown])}</h2>
          {shown !== "pages" && (
            <button type="button" onClick={onRefresh} disabled={refreshing} className={cn(PLUGINS.quietPill, "w-7 px-0")} aria-label={t("connectors.refreshTitle")} title={t("connectors.refreshTitle")}>
              <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
            </button>
          )}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        onScroll={(event) => setStuck(event.currentTarget.scrollTop > 4)}
        tabIndex={-1}
        data-plugins-list=""
        data-plugins-manage={shown}
      >
        <div className={cn(PLUGINS.gutter, "pb-8")}>
          {shown !== "pages" && scopeNote}
          {notices}
          <div className="mt-3">
            {shown === "pages" && props.pages}
            {shown === "sources" && props.sources}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The filter button of the one control row, Discover only (#4453): the
 * categories (All, Productivity, ...) live in its menu, not in a row of
 * pills. The chosen category shows on the button. */
export function DiscoverFilter({ chips, filter, onPick, label }: { chips: readonly PluginFilter[]; filter: PluginFilter; onPick: (filter: PluginFilter) => void; label: (chip: PluginFilter) => string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(open, ref, () => setOpen(false));
  if (chips.length <= 1) return null;
  return (
    <div ref={ref} className="relative shrink-0" data-plugins-filter="">
      <button type="button" aria-haspopup="menu" aria-expanded={open} data-plugins-filter-button="" onClick={() => setOpen((value) => !value)}
        className={cn(PLUGINS.quietPill, "h-8 gap-1.5 px-3 text-[13px]", filter !== "all" && "text-ink")}>
        <ListFilter size={13} aria-hidden="true" />
        {filter === "all" ? t("connectApps.filter.button") : label(filter)}
      </button>
      {open && (
        <div role="menu" aria-label={t("connectApps.filtersAria")} className={cn(MENU_SURFACE, "absolute right-0 top-9 z-20 min-w-48")}>
          {chips.map((chip) => (
            <button key={chip} type="button" role="menuitemradio" aria-checked={filter === chip} data-plugins-chip={chip}
              onClick={() => { setOpen(false); onPick(chip); }} className={filter === chip ? MENU_ROW_ACTIVE : MENU_ROW}>
              <span className="min-w-0 flex-1 truncate">{label(chip)}</span>
              {filter === chip && <Check size={14} className="shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The title bar's "..." (#4453): Bot templates, Published pages, Sources. */
function MoreViewsMenu({ views, onPick, onRefresh, refreshing }: { views: ReadonlyArray<{ id: ConnectAppsTab; key: LocaleKey; icon: ReactNode }>; onPick: (tab: ConnectAppsTab) => void; onRefresh: () => void; refreshing: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(open, ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative shrink-0" data-plugins-more="">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t("connectApps.more.aria")} title={t("connectApps.more.aria")}
        onClick={() => setOpen((value) => !value)} className="ui-icon-button" data-plugins-more-button="">
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className={cn(MENU_SURFACE, "absolute right-0 top-9 z-20 min-w-48")}>
          {/* Refresh: plugins, servers, skills and the engine accounts' connectors, together */}
          <button type="button" role="menuitem" data-plugins-refresh="" disabled={refreshing}
            onClick={() => { setOpen(false); onRefresh(); }} className={MENU_ROW}>
            <RefreshCw size={14} aria-hidden="true" className={cn(refreshing && "animate-spin")} />
            {t("connectApps.refresh")}
          </button>
          {views.map((view) => (
            <button key={view.id} type="button" role="menuitem" data-plugins-view-link={view.id}
              onClick={() => { setOpen(false); onPick(view.id); }} className={MENU_ROW}>
              {view.icon}
              {t(view.key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One row: icon, name, one line, and Connect or the status. An installed
 * row opens its page. `sub` says another line than the description (a
 * recommendation's why); the description stays in the line's tooltip. */
export function PluginRow({ item, onOpen, action, below, meta, sub }: { item: PluginItem; onOpen: (item: PluginItem) => void; action: ReactNode; below?: ReactNode; meta?: ReactNode; sub?: string }) {
  const opens = item.installed;
  return (
    <div data-plugin-row={item.key} className="py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!opens}
          onClick={() => onOpen(item)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left disabled:cursor-default"
          aria-label={opens ? t("connectApps.openAria", { name: item.name }) : undefined}
        >
          <PluginIcon item={item} className="size-10 rounded-[10px]" />
          <span className="min-w-0 flex-1">
            <span className={PLUGINS.rowName}>{item.name}</span>
            <span className={PLUGINS.rowSub} title={item.description}>
              {meta && <span className="mr-1.5 inline-flex align-middle">{meta}</span>}
              {sub ?? item.description}
            </span>
          </span>
        </button>
        {action ?? (item.installed ? (item.status === "connected" ? <ConnectedMark /> : <PluginStatusLabel status={item.status} className="text-[12px] font-normal" />) : null)}
      </div>
      {below}
    </div>
  );
}
