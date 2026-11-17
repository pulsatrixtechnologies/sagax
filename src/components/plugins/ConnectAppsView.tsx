// Connect Apps (#2104, the reference's look; #4453, a person asking "to be
// able to see what are skills, connectors, plugins"). Three kind tabs
// (Skills, Connectors, Plugins), each with Yours (what is here, in the chosen
// scope) and Discover (what can be added); Bot templates, Published pages and
// Sources under the title bar's "...". A page opened from a view (a plugin, a
// skill, a custom connector) takes the whole pane under its own bar. The
// shared row parts (pills, section titles, PluginRow) live here too.
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ArrowRight, ArrowUpDown, BadgeCheck, Bot, Check, ChevronLeft, FileText, Library, ListFilter, MoreHorizontal, RefreshCw, Search, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { ADD_FALLBACK, rowLayout, type RowLayout } from "./connect-apps-row";
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
import { AnchoredMenu, useAnchoredDismiss } from "../AnchoredMenu";
import { MENU_ROW, MENU_ROW_ACTIVE, MENU_SURFACE } from "@/components/menu-look";
import { BackButton } from "../Breadcrumb";
import { PillTabs } from "../PillTabs";
import { SEGMENT_GROUP, segmentOptionClass } from "./ScopeToggle";
import { ConnectedMark, PluginIcon, PluginStatusLabel } from "./PluginParts";

export { ConnectedMark };
import { CARD_BOX, CARD_FRAME, CARD_GRID, CARD_ICON, PLUGINS } from "./plugins-style";

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


/** The filter and sort buttons live inside the search field at its right end:
 * quiet icon buttons with no round background of their own. */
const FIELD_ICON_BUTTON = "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong motion-reduce:transition-none";

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
  /** the sort button, after the filter */
  sortControl?: ReactNode;
  /** "N updates" before Add: one press updates everything (#4504) */
  updateControl?: ReactNode;
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

/** Connect Apps (#4453, the reference's Customize): the title
 * and "..." (Bot templates, Published pages, Sources); the three kind tabs
 * (Skills, Connectors, Plugins) with their counts, the one search and the
 * one "+ Add"; Yours or Discover with the refresh, and no scope (it is
 * chosen on each item, #4453); then the list of the chosen kind, which
 * alone scrolls. Bots, Pages and Sources open alone under "< Connect Apps".
 * A page (a plugin, a skill, a custom connector) takes the whole pane under
 * its own bar. */
export function ConnectAppsView(props: ConnectAppsViewProps) {
  const { tab, onTab, onBack, tabs = CONNECT_APPS_TABS, kind = "connectors", onKind, home = "installed", scopeNote, manageActions, search, results, page, notices, refreshing, onRefresh, botName, filterControl, sortControl, updateControl } = props;
  const shown = tabs.includes(tab) ? tab : tabs.includes("installed") ? "installed" : tabs[0] ?? "installed";
  const [stuck, setStuck] = useState(false);
  // the row's width decides what shrinks, never a second line (connect-apps-row.ts): the search field,
  // then the search as an icon, then "+ Add" as an icon, then the filter and sort inside the opened field
  const headRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<RowLayout>("full");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchToggle = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  // the opened field takes the keyboard (focus in it, the row under it unreachable); folded, its button gets focus back
  useLayoutEffect(() => {
    const head = headRef.current;
    if (!head) return;
    const overlay = head.querySelector<HTMLElement>("[data-plugins-search-expanded]");
    for (const child of Array.from(head.children)) {
      // the covered row neither takes focus nor paints (no border of it shows past the field)
      const covered = child !== overlay && overlay !== null;
      if (covered) child.setAttribute("inert", ""); else child.removeAttribute("inert");
      (child as HTMLElement).style.visibility = covered ? "hidden" : "";
    }
    if (overlay && !wasOpen.current) overlay.querySelector<HTMLElement>("input")?.focus();
    else if (!overlay && wasOpen.current) searchToggle.current?.focus();
    wasOpen.current = overlay !== null;
  });
  const addLabel = useRef<{ locale: string; width: number } | null>(null);
  const controlsWidth = useRef(0);
  useLayoutEffect(() => {
    const head = headRef.current;
    if (!head || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = head.getBoundingClientRect().width;
      if (width <= 0) return;
      const of = (selector: string) => head.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? 0;
      // no layout to measure (a test renderer): nothing to decide
      const kinds = of("[data-plugins-kinds]");
      if (kinds === 0) return;
      // "+ Add" with its label is measured while the label shows, and kept for the layouts that hide it
      const locale = activeLocale();
      const addNow = of("[data-plugins-add]");
      if (addNow > 0 && head.getAttribute("data-plugins-layout") !== "compact" && head.getAttribute("data-plugins-layout") !== "minimal") addLabel.current = { locale, width: addNow };
      const addFull = addNow > 0 ? (addLabel.current?.locale === locale ? addLabel.current.width : ADD_FALLBACK) : 0;
      // the filter and the sort leave the row in the narrowest layout: their width is kept from when they showed
      const controlsNow = of("[data-plugins-search-controls]");
      if (controlsNow > 0) controlsWidth.current = controlsNow;
      const controls = controlsNow > 0 || head.querySelector("[data-plugins-search-slot], [data-plugins-search-toggle]") !== null ? controlsWidth.current : 0;
      setLayout(rowLayout(width, { kinds, views: of("[data-plugins-views]"), update: of("[data-plugins-update-all]"), controls, addFull, search: head.querySelector("[data-plugins-search-slot], [data-plugins-search-toggle]") !== null }));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(head);
    return () => watch.disconnect();
  });
  const narrow = layout !== "full";
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
    // the filter (Discover) and the sort, after the text, inside the field (a thin separator before them)
    const controls = (filterControl || sortControl) ? (
      <span className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-ink/10 pl-1" data-plugins-search-controls="">
        {shown === "discover" && filterControl}
        {sortControl}
      </span>
    ) : null;
    const cloned = Boolean(search && isValidElement(search) && typeof search.type !== "string");
    const field = cloned
      ? cloneElement(search as ReactElement<{ trailing?: ReactNode }>, { trailing: controls })
      : <>{search}{controls}</>;
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={shown} data-plugins-kind={kind}>
        {/* the title, the kind tabs and the view row stay put: only the list
            scrolls, under a hairline once it moves (#2948) */}
        <div
          className={cn(PLUGINS.gutter, "shrink-0 border-b border-transparent pb-3 pt-[22px]", stuck && "border-hairline-weak")}
          data-plugins-title-row=""
          data-plugins-stuck={stuck ? "" : undefined}
        >
          {/* the title line keeps the title, "..." and the close button */}
          <header className="flex min-h-8 items-center gap-2 pr-9" data-plugins-head="">
            {onBack && <BackButton onBack={onBack} data={{ "data-apps-back": "" }} />}
            <h2 id="plugins-title" className={cn(PLUGINS.title, "min-w-fit flex-1 break-words")}>
              {botName ? t("connectApps.titleForBot", { name: botName }) : t("connectApps.title")}
            </h2>
            <MoreViewsMenu views={moreViews} onPick={onTab} onRefresh={onRefresh} refreshing={refreshing} />
          </header>
          {/* ONE row (#4453, 2026-11-16, the owner's layout): the kinds as pill
              tabs (no counts), a separator, Yours | Discover as a segmented
              control; then, right-aligned, the search, the filter (Discover,
              icon only) and "+ Add". Every element is 32px high on one
              baseline; narrow, the search shrinks, then is an icon button
              that opens over the row; it never wraps. */}
          <div ref={headRef} className="relative mt-3 flex h-8 flex-nowrap items-center gap-x-2.5" data-plugins-kind-row="" data-plugins-layout={layout}>
            <PillTabs
              tabs={CONNECT_APPS_KINDS}
              tab={kind}
              onTab={(id) => onKind?.(id)}
              ariaLabel={t("connectApps.kind.aria")}
              idPrefix="connect-apps-kind"
              label={connectAppsKindLabel}
              tabAttributes={(id) => ({ "data-plugins-kind-tab": id })}
              tabClassName={() => "h-8 px-3.5 font-medium"}
              className="shrink-0 flex-nowrap"
              data-plugins-kinds=""
            />
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-ink/10" data-plugins-separator="" />
            <div role="radiogroup" aria-label={t("connectApps.view.aria")} className={cn(SEGMENT_GROUP, "shrink-0")} data-plugins-views=""
              onKeyDown={(event) => {
                // arrow keys move the choice, as in any radio group
                const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = shown === "installed" ? "discover" : "installed";
                onTab(next);
                event.currentTarget.querySelector<HTMLElement>(`[data-plugins-view="${next}"]`)?.focus();
              }}>
              {(["installed", "discover"] as const).map((id) => (
                <button key={id} type="button" role="radio" aria-checked={shown === id} tabIndex={shown === id ? 0 : -1} data-plugins-view={id}
                  onClick={() => onTab(id)} className={segmentOptionClass(shown === id, false, true)}>
                  {t(id === "installed" ? "connectApps.view.yours" : "connectApps.manage.tab.discover")}
                </button>
              ))}
            </div>
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2.5" data-plugins-actions="">
              {field && !narrow && <div className="w-[220px] min-w-[140px] shrink" data-plugins-search-slot="">{field}</div>}
              {narrow && layout !== "minimal" && controls}
              {search && narrow && (
                <button ref={searchToggle} type="button" onClick={() => setSearchOpen(true)} aria-expanded={searchOpen} className={cn(PLUGINS.quietPill, "size-8 px-0")} aria-label={t("connectApps.search.open")} title={t("connectApps.search.open")} data-plugins-search-toggle="">
                  <Search size={15} aria-hidden="true" />
                </button>
              )}
              {updateControl}
              {manageActions}
            </div>
            {search && narrow && searchOpen && (
              <div className="absolute inset-0 z-10 flex items-center gap-2 bg-inset" data-plugins-search-slot="" data-plugins-search-expanded=""
                onKeyDown={(event) => {
                  // the field empties on its own Escape; empty, Escape folds the search, and only the next one is the window's
                  if (event.key !== "Escape") return;
                  // a filter or sort menu open in the field closes first (its own Escape, heard at the window)
                  if (document.querySelector("[data-anchored-menu]")) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setSearchOpen(false);
                }}>
                <div className="min-w-0 flex-1">{field}</div>
                <button type="button" onClick={() => setSearchOpen(false)} className={cn(PLUGINS.quietPill, "size-8 px-0")} aria-label={t("connectApps.search.close")} title={t("connectApps.search.close")} data-plugins-search-close="">
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            )}
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  useAnchoredDismiss(open, ref, menuRef, () => setOpen(false));
  if (chips.length <= 1) return null;
  return (
    <div ref={ref} className="relative shrink-0" data-plugins-filter="">
      <button type="button" aria-haspopup="menu" aria-expanded={open} data-plugins-filter-button="" onClick={() => setOpen((value) => !value)}
        aria-label={filter === "all" ? t("connectApps.filter.button") : `${t("connectApps.filter.button")}: ${label(filter)}`}
        title={filter === "all" ? t("connectApps.filter.button") : label(filter)}
        className={cn(FIELD_ICON_BUTTON, filter !== "all" && "text-ink")}>
        <ListFilter size={15} aria-hidden="true" />
        {filter !== "all" && <span data-plugins-active-dot="" className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </button>
      {open && (
        <AnchoredMenu anchor={ref} menuRef={menuRef} role="menu" aria-label={t("connectApps.filtersAria")} className={cn(MENU_SURFACE, "min-w-48")}>
          {chips.map((chip) => (
            <button key={chip} type="button" role="menuitemradio" aria-checked={filter === chip} data-plugins-chip={chip}
              onClick={() => { setOpen(false); onPick(chip); }} className={filter === chip ? MENU_ROW_ACTIVE : MENU_ROW}>
              <span className="min-w-0 flex-1 truncate">{label(chip)}</span>
              {filter === chip && <Check size={14} className="shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </AnchoredMenu>
      )}
    </div>
  );
}

/** The "N updates" pill before Add: it says how many items have an update and
 * updates all of them; none, nothing is drawn. */
export function UpdateAllPill({ count, running, onUpdateAll }: { count: number; running: boolean; onUpdateAll: () => void }) {
  if (count <= 0 && !running) return null;
  const label = count === 1 ? t("connectApps.updates.one") : t("connectApps.updates.many", { count });
  // compact: the refresh icon and the count; the words are the tooltip and the accessible name
  return (
    <button type="button" data-plugins-update-all={running ? "running" : ""} disabled={running} onClick={onUpdateAll}
      aria-label={`${t("connectApps.updates.all")}: ${label}`} title={`${t("connectApps.updates.all")}: ${label}`}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent/15 px-2.5 text-[13px] leading-[18px] tabular-nums text-accent-text transition-colors hover:bg-accent/25 disabled:opacity-70 motion-reduce:transition-none">
      <RefreshCw size={13} className={cn(running && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      {running ? null : <span data-update-count="">{count}</span>}
    </button>
  );
}

/** How a list is ordered: the lists' own order, by name, or what is on first. */
export type ConnectAppsSort = "default" | "name" | "on" | "update";

/** The sort icon button of the control row (two opposed arrows): only the
 * keys that have data here (name everywhere; "on first" on Yours). */
export function SortControl({ sort, onSort, options }: { sort: ConnectAppsSort; onSort: (sort: ConnectAppsSort) => void; options: readonly ConnectAppsSort[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useAnchoredDismiss(open, ref, menuRef, () => setOpen(false));
  const LABEL: Record<ConnectAppsSort, LocaleKey> = { default: "connectApps.sort.default", name: "connectApps.sort.name", on: "connectApps.sort.on", update: "connectApps.sort.update" };
  return (
    <div ref={ref} className="relative shrink-0" data-plugins-sort="">
      <button type="button" aria-haspopup="menu" aria-expanded={open} data-plugins-sort-button="" onClick={() => setOpen((value) => !value)}
        aria-label={t("connectApps.sort.button")} title={t("connectApps.sort.button")}
        className={cn(FIELD_ICON_BUTTON, sort !== "default" && "text-ink")}>
        <ArrowUpDown size={15} aria-hidden="true" />
        {sort !== "default" && <span data-plugins-active-dot="" className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </button>
      {open && (
        <AnchoredMenu anchor={ref} menuRef={menuRef} role="menu" aria-label={t("connectApps.sort.button")} className={cn(MENU_SURFACE, "min-w-48")}>
          {options.map((option) => (
            <button key={option} type="button" role="menuitemradio" aria-checked={sort === option} data-plugins-sort-option={option}
              onClick={() => { setOpen(false); onSort(option); }} className={sort === option ? MENU_ROW_ACTIVE : MENU_ROW}>
              <span className="min-w-0 flex-1 truncate">{t(LABEL[option])}</span>
              {sort === option && <Check size={14} className="shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </AnchoredMenu>
      )}
    </div>
  );
}

/** Rows in the chosen order; "default" leaves the list's own. Stable. */
export function sortRows<T>(rows: readonly T[], sort: ConnectAppsSort, nameOf: (row: T) => string, onOf: (row: T) => boolean, updateOf?: (row: T) => boolean): T[] {
  if (sort === "update" && updateOf) return [...rows].sort((a, b) => Number(updateOf(b)) - Number(updateOf(a)));
  if (sort === "name") return [...rows].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (sort === "on") return [...rows].sort((a, b) => Number(onOf(b)) - Number(onOf(a)));
  return [...rows];
}

/** The title bar's "..." (#4453): Bot templates, Published pages, Sources. */
function MoreViewsMenu({ views, onPick, onRefresh, refreshing }: { views: ReadonlyArray<{ id: ConnectAppsTab; key: LocaleKey; icon: ReactNode }>; onPick: (tab: ConnectAppsTab) => void; onRefresh: () => void; refreshing: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useAnchoredDismiss(open, ref, menuRef, () => setOpen(false));
  return (
    <div ref={ref} className="relative shrink-0" data-plugins-more="">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t("connectApps.more.aria")} title={t("connectApps.more.aria")}
        onClick={() => setOpen((value) => !value)} className="ui-icon-button" data-plugins-more-button="">
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <AnchoredMenu anchor={ref} menuRef={menuRef} role="menu" className={cn(MENU_SURFACE, "min-w-48")}>
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
        </AnchoredMenu>
      )}
    </div>
  );
}

export { CARD_BOX, CARD_FRAME, CARD_GRID, CARD_ICON };
export { CardTrail } from "./ItemTrailer";

/** A group's heading: the title with its count badge, and at the right the group's link ("View all", "Manage on ..."); one component for Yours and Discover. */
export function SectionHead({ title, id, count, onViewAll, link }: { title: string; id?: string; /** the count in a small rounded badge next to the title */ count?: number; onViewAll?: () => void; link?: { label: string; onClick: () => void; manage: string } }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className={PLUGINS.groupTitle}>{title}</h3>
        {count !== undefined && count > 0 && <span className="mt-1 rounded-full bg-ink/[0.08] px-2 text-[12px] leading-4 tabular-nums text-ink-secondary" data-section-count={count}>{count}</span>}
      </div>
      {link && (
        <button type="button" data-harness-manage={link.manage} className={PLUGINS.groupLink} onClick={link.onClick}>
          {link.label}
        </button>
      )}
      {!link && onViewAll && (
        <button type="button" data-plugins-view-all={id ?? ""} className={PLUGINS.groupLink} onClick={onViewAll}>
          {t("connectApps.viewAll")}<ArrowRight size={12} aria-hidden="true" className="ml-1 inline" />
        </button>
      )}
    </div>
  );
}

/** A Discover card: a square icon tile; the name (a reviewed mark when the
 * item comes from the reviewed catalog) and, where it applies, a small
 * outlined chip; two lines of description; a last grey line (Added with a
 * check when it is installed, then where it comes from); at the top right the
 * item's action (the square "+" Install menu) or a green check. */
export function DiscoverCard({ item, onOpen, action, from, sub, openable = false }: { item: PluginItem; onOpen: (item: PluginItem) => void; action: ReactNode; /** where it comes from, in words */ from?: string; sub?: string; /** the card opens its page though it is not installed (a bundle) */ openable?: boolean }) {
  const opens = item.installed || openable;
  const reviewed = item.source === "catalog";
  const chip = !item.installed && item.action === "add" && (item.kind === "featured" || item.kind === "mcp" || item.kind === "app") ? t("connectApps.card.noSignIn") : null;
  return (
    <div data-plugin-row={item.key} data-discover-card="" className={CARD_BOX}>
      <button type="button" disabled={!opens} onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left disabled:cursor-default"
        aria-label={opens ? t("connectApps.openAria", { name: item.name }) : undefined}>
        <PluginIcon item={item} className={CARD_ICON} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn(PLUGINS.rowName, "min-w-0")}>{item.name}</span>
            {reviewed && <BadgeCheck size={14} className="shrink-0 text-accent-text" aria-label={t("connectApps.card.verified")} data-card-verified="" />}
            {chip && <span className="shrink-0 rounded-full border-[0.5px] border-ink/20 px-1.5 text-[11px] leading-4 text-ink-secondary" data-card-chip="">{chip}</span>}
          </span>
          <span className={PLUGINS.rowSub} title={item.description}>{sub ?? item.description}</span>
          {(item.installed || from) && (
            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-tertiary" data-card-meta="">
              {item.installed && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-1.5 text-success" data-card-added="">
                  <Check size={11} aria-hidden="true" />{t("connectApps.card.added")}
                </span>
              )}
              {from && <span className="min-w-0 truncate">{from}</span>}
            </span>
          )}
        </span>
      </button>
      <div className="shrink-0" data-card-action="">
        {item.installed && !action ? (
          <span className="flex size-8 items-center justify-center rounded-lg bg-success/10 text-success" data-card-installed=""><Check size={15} aria-hidden="true" /></span>
        ) : action}
      </div>
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
