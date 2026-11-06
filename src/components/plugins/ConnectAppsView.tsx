// Plugins (#2104, 2026-11-05: once Capabilities / Connect apps): one large
// modal, one title, one install scope (this bot, me, organization) beside the
// one search (it looks everywhere, ConnectAppsSearch.tsx), then three tabs:
// Installed (what is here: plugins, skills, MCP servers, the Mac apps and the
// connectors of the engine accounts, with one "+ Add" menu), Discover (the
// catalog) and Sources (the marketplaces and the GitHub connection, with the
// organization's part for an admin). One refresh, on the tab row, reloads it
// all. Bots (Browse Bots) and Pages (the published pages) are not plugins:
// a link that asks for them opens this same window as a pane of its own.
// A page opened from a tab (a plugin's detail, a skill, "For which bots")
// opens inside that tab's panel, under the same title, scope and tabs, as a
// Settings sub-page does: a back row, then the page (2026-10-28).
// The shared row parts (pills, section titles, PluginRow) live here too.
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

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
import { CATEGORY_MODAL } from "../category-modal";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";

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
/** Plugins (#2104, 2026-11-05): three tabs, Installed first (what a person
 * has), then Discover (the catalog) and Sources (where plugins come from).
 * Bots (Browse Bots) and Pages (the published pages) are not plugins: a
 * link that asks for them opens the same window as a pane of its own, with
 * its own title and no tab row (STANDALONE_PANES). */
export const CONNECT_APPS_TABS: readonly ConnectAppsTab[] = ["installed", "discover", "sources"];
export const STANDALONE_PANES: readonly ConnectAppsTab[] = ["bots", "pages"];

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
  /** tabs with nothing to show are left out (Sources when nothing reads
   * or changes a source) */
  tabs?: readonly ConnectAppsTab[];
  /** connected things per tab (connectedCounts): a counter beside its name */
  counts?: Partial<Record<ConnectAppsTab, number>>;
  /** the install scope (everyone, or one bot), under the title on every tab
   * (Pages and Bots show it turned off, with why): the title and the tabs
   * never move from one tab to another. The one search sits on its right. */
  scope?: ReactNode;
  /** the line under the scope and the search: what the scope does here */
  scopeNote?: ReactNode;
  /** a page opened from the open tab (a plugin's detail, a skill): shown in
   * the tab's panel, the title, scope and tabs kept above it */
  page?: ReactNode;
  /** the one search (ConnectAppsSearch), under the scope on every tab */
  search?: ReactNode;
  /** what the search found: shown in place of the open tab's list while
   * the search has text (a page opened from a result stays on top) */
  results?: ReactNode;
  /** notices between the tabs and the panel */
  notices?: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  installed?: ReactNode;
  discover?: ReactNode;
  /** Browse Bots (2026-10-29): a pane with its own pages and scroll */
  bots?: ReactNode;
  pages?: ReactNode;
  sources?: ReactNode;
}

export function ConnectAppsView(props: ConnectAppsViewProps) {
  const { tab, onTab, onBack, tabs = CONNECT_APPS_TABS, counts = {}, scope, scopeNote, search, results, page, notices, refreshing, onRefresh } = props;
  // Bots and Pages open alone (a link asked for them): their own title, no
  // tab row, no install scope (neither depends on it)
  const standalone = STANDALONE_PANES.includes(tab) && !tabs.includes(tab);
  const shown = standalone || tabs.includes(tab) ? tab : tabs.includes("installed") ? "installed" : tabs[0] ?? "installed";
  // Bots is a pane of its own (its list scrolls, its pages have a back row),
  // laid out as a page opened from a tab
  const pane = !results && (page !== undefined || shown === "bots");
  const titleBlock = (
    <>
      <h2 id="plugins-title" className={CATEGORY_MODAL.title}>{standalone ? connectAppsTabLabel(shown) : t("connectApps.title")}</h2>
      {/* the scope and the one search share a line (2026-10-29, the owner):
          the search, compact, on the scope's right; narrow, it wraps under it */}
      {!standalone && (scope || search) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-plugins-scope-row>
          {scope && <div className="shrink-0" data-plugins-scope-slot>{scope}</div>}
          {search && <div className="min-w-[200px] flex-1 sm:ml-auto sm:max-w-[320px]" data-plugins-search-slot>{search}</div>}
        </div>
      )}
      {!standalone && scopeNote}
    </>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={shown} data-plugins-standalone={standalone ? shown : undefined}>
      <header className={cn(CATEGORY_MODAL.titleBar, onBack && "flex items-start gap-2")}>
        {onBack ? (
          <>
            <BackButton onBack={onBack} data={{ "data-apps-back": "" }} />
            <div className="min-w-0 flex-1">{titleBlock}</div>
          </>
        ) : titleBlock}
      </header>
      {!standalone && <div className="flex shrink-0 items-end gap-2 border-b border-hairline-weak px-4 sm:px-8" data-plugins-manage-bar>
        <div role="tablist" aria-label={t("connectApps.tabsAria")} className="flex min-w-0 flex-1 gap-5 overflow-x-auto" data-plugins-manage-tabs>
          {tabs.map((id) => {
            const count = counts[id] ?? 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`plugins-tab-${id}`}
                aria-selected={shown === id}
                // a page is open: its tab stays marked, a click goes back to the tab
                aria-current={page && shown === id ? "page" : undefined}
                aria-controls={`plugins-tabpanel-${id}`}
                aria-label={count > 0 ? t("connectApps.tabCountAria", { tab: connectAppsTabLabel(id), count }) : undefined}
                data-plugins-tab={id}
                onClick={() => onTab(id)}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 pb-2 pt-1 text-[13px] leading-[18px] transition-colors motion-reduce:transition-none",
                  shown === id ? "border-ink font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink",
                )}
              >
                <span data-plugins-tab-label>{connectAppsTabLabel(id)}</span>
                {count > 0 && (
                  <span data-plugins-tab-count={count} aria-hidden="true" className="min-w-[18px] rounded-full bg-hover px-1.5 text-center text-[11px] font-medium leading-[16px] text-ink-secondary tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="ui-icon-button mb-1 disabled:opacity-50" aria-label={t("connectors.refreshTitle")} title={t("connectors.refreshTitle")}>
          <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
        </button>
      </div>}
      {notices}
      <div
        role="tabpanel"
        id={`plugins-tabpanel-${shown}`}
        aria-labelledby={standalone ? "plugins-title" : `plugins-tab-${shown}`}
        tabIndex={-1}
        className={pane ? "flex min-h-0 flex-1 flex-col outline-none" : `${CATEGORY_MODAL.pane} ${CATEGORY_MODAL.list} outline-none`}
        data-plugins-list={pane ? undefined : ""}
        data-plugins-manage={shown}
        data-plugins-subpage={page && !results ? "" : undefined}
        data-plugins-results={results ? "" : undefined}
      >
        {results ?? page ?? (
          <>
            {shown === "installed" && props.installed}
            {shown === "discover" && props.discover}
            {shown === "bots" && props.bots}
            {shown === "pages" && props.pages}
            {shown === "sources" && props.sources}
          </>
        )}
      </div>
    </div>
  );
}

/** One row: icon, name, one line, and Add / Connect or the status. An
 * installed row opens its detail page. */
export function PluginRow({ item, onOpen, action, below }: { item: PluginItem; onOpen: (item: PluginItem) => void; action: ReactNode; below?: ReactNode }) {
  const opens = item.installed;
  return (
    <div data-plugin-row={item.key} className="rounded-2xl p-2.5 hover:bg-ink/5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!opens}
          onClick={() => onOpen(item)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
          aria-label={opens ? t("connectApps.openAria", { name: item.name }) : undefined}
        >
          <PluginIcon item={item} className="size-11" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-[18px] text-ink">{item.name}</span>
            <span className="block truncate text-[12px] leading-[18px] text-ink-secondary" title={item.description}>{item.description}</span>
          </span>
        </button>
        {action ?? (item.installed ? <PluginStatusLabel status={item.status} /> : null)}
      </div>
      {below}
    </div>
  );
}
