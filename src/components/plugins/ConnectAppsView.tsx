// Plugins (#2104, JC 2026-11-06): a copy of Grok Bot's Connect Apps. The
// home (Discover) lists what can be added under one round search; Manage
// (Installed) lists what is here; Bots, Pages and Sources are views reached
// from the home ("Bot templates") and from Manage. A page opened from a view
// (a plugin, a skill, a custom connector) takes the whole pane under its own
// bar. The shared row parts (pills, section titles, PluginRow) live here too.
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Bot, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

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
};

const SECTION_KEY: Record<string, LocaleKey> = {
  ...FILTER_KEY,
  recommended: "connectApps.section.recommended",
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
 * its tab; the tab row never hides. The install scope is drawn only where
 * it applies (SCOPELESS_TABS do not depend on it); the one search covers
 * every tab. */
export const CONNECT_APPS_TABS: readonly ConnectAppsTab[] = ["installed", "discover", "bots", "pages", "sources"];
export const SCOPELESS_TABS: readonly ConnectAppsTab[] = ["bots", "pages"];

const TAB_KEY = {
  installed: "connectApps.manage.tab.installed",
  discover: "connectApps.manage.tab.discover",
  bots: "connectApps.manage.tab.bots",
  pages: "connectApps.manage.tab.pages",
  sources: "connectApps.manage.tab.sources",
} as const satisfies Record<ConnectAppsTab, LocaleKey>;

/** A tab's name, for the tab itself and the back row of a page opened from it. */
export function connectAppsTabLabel(tab: ConnectAppsTab): string {
  return t(TAB_KEY[tab]);
}

/** What the old "N connected" header counted, now on the tab that lists
 * them (2026-10-28, the owner: the button repeated Installed): the
 * person's own connected entries on Installed (the rows it shows) plus their
 * providers' connected connectors, which Installed lists too since
 * 2026-10-29. Zero: no counter. */
export function connectedCounts(input: { entries: readonly { status: PluginItem["status"] }[]; engineConnected: number }): Partial<Record<ConnectAppsTab, number>> {
  // the rows Installed shows (one per thing, installedEntries), connected
  const own = input.entries.filter((entry) => entry.status === "connected").length;
  const total = own + Math.max(0, input.engineConnected);
  return total > 0 ? { installed: total } : {};
}

export interface ConnectAppsViewProps {
  tab: ConnectAppsTab;
  onTab: (tab: ConnectAppsTab) => void;
  /** Leave the Connect apps view (content frame back). */
  onBack?: () => void;
  /** views with something to show (Sources only when a source is reachable):
   * Manage links to the ones past Installed */
  tabs?: readonly ConnectAppsTab[];
  /** connected things per view (connectedCounts) */
  counts?: Partial<Record<ConnectAppsTab, number>>;
  /** the home's "N connected": the count and a few icons, opens Manage */
  connected?: { count: number; icons: readonly PluginItem[] };
  /** the install scope (everyone, me, one bot): in Manage's title row */
  scope?: ReactNode;
  /** what the scope does here, under Manage's title */
  scopeNote?: ReactNode;
  /** a line under the home's search while a scope other than the default is on */
  homeNote?: ReactNode;
  /** Manage's "+ Add" menu, beside the refresh */
  manageActions?: ReactNode;
  /** a page opened from a view (a plugin's detail, a skill): the whole pane */
  page?: ReactNode;
  /** the one search (ConnectAppsSearch), on the home's sticky row */
  search?: ReactNode;
  /** what the search found: in place of the home's sections */
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
  installed: "connectApps.manage.title",
  discover: "connectApps.title",
  bots: "connectApps.manage.tab.bots",
  pages: "connectApps.manage.tab.pages",
  sources: "connectApps.manage.tab.sources",
} as const satisfies Record<ConnectAppsTab, LocaleKey>;

/** Plugins (#2104, JC 2026-11-06: identical to Grok Bot's Connect Apps).
 * Home (Discover): the title and "N connected" on one line, then the round
 * search and "Bot templates" on a row that sticks to the top when the list
 * scrolls (the X joins it there), then the pills and the sections. Manage
 * (Installed) and the other views: "< Connect Apps", a big title, the list.
 * A page (a plugin, a skill, a custom connector) takes the whole pane under
 * its own bar. */
export function ConnectAppsView(props: ConnectAppsViewProps) {
  const { tab, onTab, onBack, tabs = CONNECT_APPS_TABS, connected, scope, scopeNote, homeNote, manageActions, search, results, page, notices, refreshing, onRefresh } = props;
  const shown = tabs.includes(tab) ? tab : tabs.includes("discover") ? "discover" : tabs[0] ?? "discover";
  const [stuck, setStuck] = useState(false);
  // each view opens at its top: the hairline of a scrolled list goes with it
  useEffect(() => setStuck(false), [shown]);

  if (page !== undefined && !results) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={shown} data-plugins-manage={shown} data-plugins-subpage="">
        <h2 id="plugins-title" className="sr-only">{t("connectApps.title")}</h2>
        {notices}
        {page}
      </div>
    );
  }

  if (shown === "discover") {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-plugins-main="discover">
        <div
          className="min-h-0 flex-1 overflow-y-auto outline-none"
          onScroll={(event) => setStuck(event.currentTarget.scrollTop > 4)}
          tabIndex={-1}
          data-plugins-list=""
          data-plugins-manage="discover"
          data-plugins-results={results ? "" : undefined}
        >
          <header className={cn(PLUGINS.gutter, "flex items-center gap-3 pb-[9px] pt-[50px] pr-14")}>
            {onBack && <BackButton onBack={onBack} data={{ "data-apps-back": "" }} />}
            <h2 id="plugins-title" className={cn(PLUGINS.title, "min-w-0 flex-1 truncate")}>{t("connectApps.title")}</h2>
            {/* with nothing connected it still leads to Manage (scope, pages, sources) */}
            {connected && (
              <button
                type="button"
                onClick={() => onTab("installed")}
                className="-mr-1 flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-1.5 text-[13px] text-ink-secondary hover:bg-hover hover:text-ink"
                data-plugins-connected={connected.count}
              >
                <span className="flex -space-x-1.5" aria-hidden="true">
                  {connected.icons.slice(0, 4).map((item) => (
                    <PluginIcon key={item.key} item={item} className="size-[22px] rounded-[7px] ring-2 ring-(--color-inset)" />
                  ))}
                </span>
                <span>{connected.count > 0 ? t("connectApps.connectedCount", { count: connected.count }) : t("connectApps.manageLink")}</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            )}
          </header>
          <div
            className={cn(
              PLUGINS.gutter,
              "sticky top-0 z-10 flex items-center gap-3 bg-inset py-2 transition-[padding] motion-reduce:transition-none",
              stuck && "border-b border-hairline-weak sm:pr-14",
            )}
            data-plugins-search-row
            data-plugins-stuck={stuck ? "" : undefined}
          >
            {search && <div className="min-w-0 flex-1" data-plugins-search-slot>{search}</div>}
            <button type="button" onClick={() => onTab("bots")} className={PLUGINS.textLink} data-plugins-bot-templates>
              <span className="flex size-[18px] items-center justify-center rounded-full bg-ink text-app" aria-hidden="true"><Bot size={12} /></span>
              {t("connectApps.botTemplates")}
              <ArrowUpRight size={14} className="text-ink-secondary" aria-hidden="true" />
            </button>
          </div>
          {homeNote && <div className={PLUGINS.gutter}>{homeNote}</div>}
          {notices}
          <div className={cn(PLUGINS.gutter, "pb-8 pt-3")}>{results ?? props.discover}</div>
        </div>
      </div>
    );
  }

  const extraViews = tabs.filter((id) => id === "pages" || id === "sources");
  const backBar = (
    <div className="flex h-12 shrink-0 items-center px-3 pr-14" data-plugins-manage-bar>
      <button
        type="button"
        onClick={() => onTab("discover")}
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
          {shown !== "pages" && scope && <div className="shrink-0" data-plugins-scope-slot>{scope}</div>}
          {shown !== "pages" && (
            <button type="button" onClick={onRefresh} disabled={refreshing} className={cn(PLUGINS.quietPill, "w-7 px-0")} aria-label={t("connectors.refreshTitle")} title={t("connectors.refreshTitle")}>
              <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
            </button>
          )}
          {shown === "installed" && manageActions}
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
            {shown === "installed" && props.installed}
            {shown === "pages" && props.pages}
            {shown === "sources" && props.sources}
          </div>
          {shown === "installed" && extraViews.length > 0 && (
            <div className="mt-8" data-plugins-more-views>
              <h3 className={cn(PLUGINS.label, "mb-1")}>{t("connectApps.manage.more")}</h3>
              {extraViews.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTab(id)}
                  className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-hover"
                  data-plugins-view-link={id}
                >
                  <span className={cn(PLUGINS.rowName, "flex-1")}>{connectAppsTabLabel(id)}</span>
                  <ChevronRight size={16} className="text-ink-secondary" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One row: icon, name, one line, and Connect or the status. An installed
 * row opens its page. */
export function PluginRow({ item, onOpen, action, below, meta }: { item: PluginItem; onOpen: (item: PluginItem) => void; action: ReactNode; below?: ReactNode; meta?: ReactNode }) {
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
              {item.description}
            </span>
          </span>
        </button>
        {action ?? (item.installed ? (item.status === "connected" ? <ConnectedMark /> : <PluginStatusLabel status={item.status} className="text-[13px] font-normal" />) : null)}
      </div>
      {below}
    </div>
  );
}
