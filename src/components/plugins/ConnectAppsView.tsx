// Plugins, main view ("Connect Apps"): every app, MCP server, catalog plugin
// and skill in one list. The chrome matches Grok Bot's Connect Apps: the
// title with "N connected" at its right, the search with Bot templates
// beside it, All and the main categories, the rest under More, then the
// sections in two columns. View all opens a section as its own page.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, LayoutGrid, Loader2, Search } from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  CATEGORY_ORDER,
  MAIN_CATEGORIES,
  MORE_CATEGORIES,
  connectedSummary,
  mainSections,
  type PluginFilter,
  type PluginItem,
  type PluginSection,
  type PluginTypeFilter,
} from "@/lib/plugins-model";
import { Breadcrumb, type Crumb } from "../Breadcrumb";
import { CATEGORY_MODAL, categoryChipClass } from "../category-modal";
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

const PAGE = 60;

/** A section opened alone (View all) in the panel's window: its title, the
 * pages above it, and back. */
export interface ConnectAppsSubpage {
  title: string;
  trail: readonly Crumb[];
  onBack: () => void;
}

export interface ConnectAppsViewProps {
  items: PluginItem[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  filter: PluginFilter;
  onFilter: (filter: PluginFilter) => void;
  /** the type filter (a View all on a kind or a source) */
  type?: PluginTypeFilter;
  onType?: (type: PluginTypeFilter) => void;
  /** marketplace (or other) sources: a type of their own and a section */
  extraSources?: string[];
  /** connectors a Claude account brings, counted in "N connected" */
  extraConnected?: number;
  sourceLabel?: (source: string) => string;
  onOpenManage: () => void;
  /** Browse Bots, top right beside the title (2026-10-16: it left the avatar
   * menu, then the search row); absent, no button */
  onBrowseBots?: () => void;
  /** View all on a section: the panel opens it as a page of its own (absent:
   * the section's filter is applied in place) */
  onViewAll?: (section: PluginSection) => void;
  /** this view is a section opened alone: a breadcrumb and its title */
  subpage?: ConnectAppsSubpage;
  onOpenItem: (item: PluginItem) => void;
  /** the row's Add / Connect button */
  renderAction: (item: PluginItem) => ReactNode;
  /** what goes under a row (an account name field, a status line) */
  renderBelow?: (item: PluginItem) => ReactNode;
  /** notices between the search and the list */
  notices?: ReactNode;
  /** the install scope (everyone, or one bot) under the title */
  scope?: ReactNode;
  /** apps a conversation needs (its Connect apps pill): shown first */
  focus?: readonly string[];
}

export function ConnectAppsView(props: ConnectAppsViewProps) {
  const { items, loading, search, onSearch, filter, onFilter, type = "any", onType, extraSources = [], extraConnected = 0, sourceLabel,
    onOpenManage, onBrowseBots, onViewAll, subpage, onOpenItem, renderAction, renderBelow, notices, scope, focus } = props;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [filter, type, search]);

  const sections = mainSections(items, search, filter, type, extraSources, focus);
  const summary = connectedSummary(items, extraConnected);
  const single = subpage !== undefined || (sections.length === 1 && (search.trim() !== "" || filter !== "all" || type !== "any"));
  const viewAll = (section: PluginSection) => {
    if (!section.filter) return;
    if (onViewAll) { onViewAll(section); return; }
    if ("filter" in section.filter) onFilter(section.filter.filter);
    else onType?.(section.filter.type);
  };

  const more = moreCategoryPills(items, filter);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={subpage ? "section" : "home"}>
      <header className={CATEGORY_MODAL.titleBar}>
        {subpage && <Breadcrumb trail={subpage.trail} current={subpage.title} onBack={subpage.onBack} backData={{ "data-plugins-back": "" }} />}
        <div className="flex items-center justify-between gap-4">
          <h2 id="plugins-title" className={CATEGORY_MODAL.title}>{subpage ? subpage.title : t("connectApps.title")}</h2>
          <ConnectedButton summary={summary} onOpen={onOpenManage} />
        </div>
        {scope && <div className="mt-3">{scope}</div>}
      </header>

      <div className={CATEGORY_MODAL.toolbar}>
        {!subpage && (
          <div className={CATEGORY_MODAL.chips} role="toolbar" aria-label={t("connectApps.filtersAria")} data-plugins-chips>
            {categoryPills(items, filter).map((chip) => (
              <button
                key={chip}
                type="button"
                aria-pressed={filter === chip}
                data-plugins-chip={chip}
                onClick={() => onFilter(chip)}
                className={categoryChipClass(filter === chip)}
              >
                {filterLabel(chip, sourceLabel)}
              </button>
            ))}
            {more.length > 0 && (
              <MoreCategories pills={more} filter={filter} onFilter={onFilter} sourceLabel={sourceLabel} />
            )}
          </div>
        )}
        <div className={subpage ? "flex items-center gap-2" : "mt-3 flex items-center gap-2"}>
          <label className={CATEGORY_MODAL.search}>
            <Search size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={t("connectApps.searchPlaceholder")}
              aria-label={t("connectApps.searchPlaceholder")}
              data-plugins-search
              className={CATEGORY_MODAL.searchInput}
            />
          </label>
          {!subpage && onBrowseBots && (
            <button
              type="button"
              data-plugins-browse-bots
              onClick={onBrowseBots}
              className={CATEGORY_MODAL.outlineButton}
            >
              <LayoutGrid size={16} className="text-ink-secondary" aria-hidden="true" />
              <span>{t("connectApps.botTemplates")}</span>
              <ChevronRight size={14} className="text-ink-secondary" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {notices}

      <div className={`${CATEGORY_MODAL.pane} ${CATEGORY_MODAL.list}`} data-plugins-list>
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
          </div>
        ) : sections.every((section) => section.items.length === 0) ? (
          <div className="flex min-h-56 flex-col items-center justify-center text-center">
            <div className="text-[14px] font-medium text-ink">{t("connectors.noAppsFound")}</div>
            <div className="mt-1 text-[12.5px] text-ink-secondary">{t("connectors.tryDifferentSearch")}</div>
          </div>
        ) : (
          sections.map((section) => {
            const shown = single ? section.items.slice(0, limit) : section.items;
            return (
              <section key={section.id} data-plugins-section={section.id} className={CATEGORY_MODAL.section}>
                {!subpage && (
                  <div className={CATEGORY_MODAL.sectionHead}>
                    <h3 className={CATEGORY_MODAL.sectionTitle}>{sectionTitle(section, sourceLabel)}</h3>
                    {!single && section.filter && section.total > section.items.length && (
                      <button type="button" data-plugins-view-all={section.id} onClick={() => viewAll(section)} className={CATEGORY_MODAL.sectionLink}>
                        {t("connectApps.viewAll")}
                      </button>
                    )}
                  </div>
                )}
                <div className={CATEGORY_MODAL.grid}>
                  {shown.map((item) => (
                    <PluginRow key={item.key} item={item} onOpen={onOpenItem} action={renderAction(item)} below={renderBelow?.(item)} />
                  ))}
                </div>
                {single && section.items.length > shown.length && (
                  <div className="mt-3 flex justify-center">
                    <button type="button" onClick={() => setLimit((current) => current + PAGE)} className="ui-button">
                      {t("connectApps.showMore", { count: section.items.length - shown.length })}
                    </button>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function ConnectedButton({ summary, onOpen }: { summary: ReturnType<typeof connectedSummary>; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-plugins-connected
      onClick={onOpen}
      className="flex shrink-0 items-center gap-2 text-[13px] leading-[18px] text-ink hover:text-ink"
      aria-label={t("connectApps.manageAria", { count: summary.count })}
    >
      {summary.icons.length > 0 && (
        <span className="flex -space-x-1.5" aria-hidden="true">
          {summary.icons.map((item) => (
            <span key={item.key} className="rounded-md ring-2 ring-app">
              <PluginIcon item={item} className="size-5 rounded-md" />
            </span>
          ))}
        </span>
      )}
      <span>{t("connectApps.connectedCount", { count: summary.count })}</span>
      <ChevronRight size={14} className="text-ink-secondary" aria-hidden="true" />
    </button>
  );
}

/** The categories that are not on the row, as Grok Bot's More chip. */
function MoreCategories({ pills, filter, onFilter, sourceLabel }: {
  pills: PluginFilter[];
  filter: PluginFilter;
  onFilter: (filter: PluginFilter) => void;
  sourceLabel?: (source: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = pills.includes(filter);
  return (
    <div className="relative">
      <button
        type="button"
        data-plugins-more
        aria-pressed={chosen}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={categoryChipClass(chosen)}
      >
        {t("connectApps.filter.more")}
        <ChevronDown size={12} className="ml-1 inline" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-8 z-20 min-w-40 rounded-xl border border-border bg-card p-1 shadow-lg">
          {pills.map((chip) => (
            <button
              key={chip}
              type="button"
              role="menuitem"
              aria-pressed={filter === chip}
              data-plugins-chip={chip}
              onClick={() => { onFilter(chip); setOpen(false); }}
              className="block w-full rounded-lg px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
            >
              {filterLabel(chip, sourceLabel)}
            </button>
          ))}
        </div>
      )}
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
