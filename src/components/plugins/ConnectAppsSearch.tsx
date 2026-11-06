// Connect Apps' one search (2026-10-29, the owner: one option, one place):
// the field under the title and the scope, on every tab, and what it found,
// shown in place of the open tab's list while it has text. The matches come
// grouped by kind (src/lib/connect-apps-search.ts); a click or Enter opens
// the match's page or tab. The keyboard stays in the field: the arrows walk
// the rows, Enter opens the lit one (the first by default), Escape empties
// the field (then, empty, Escape steps back or closes as before).
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FileText, GitBranch, Search, Store, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { itemCreator, itemDescription, itemName } from "@/lib/bot-catalog";
import { GROUP_PREVIEW, moveActive, visibleResults, type SearchGroup, type SearchGroupId, type SearchResult } from "@/lib/connect-apps-search";
import type { LocaleKey } from "@/locales";
import { PLUGINS } from "./plugins-style";
import { CatalogMascot, itemLook, nameColor } from "../bot-catalog/BotCatalogView";
import { PluginIcon } from "./PluginParts";

const GROUP_KEY: Record<SearchGroupId, LocaleKey> = {
  plugins: "connectApps.search.group.plugins",
  apps: "connectApps.search.group.apps",
  skills: "connectApps.filter.skills",
  mcp: "connectApps.filter.mcp",
  bots: "connectApps.manage.tab.bots",
  templates: "botCatalog.section.templates",
  pages: "connectApps.manage.tab.pages",
  sources: "connectApps.manage.tab.sources",
};

export function searchGroupTitle(id: SearchGroupId): string {
  return t(GROUP_KEY[id]);
}

/** The home's round search (#2104, Grok Bot's Connect Apps). */
const SEARCH_BOX = PLUGINS.search;

const LISTBOX_ID = "connect-apps-search-results";
const optionId = (index: number) => `connect-apps-result-${index}`;

export interface ConnectAppsSearchFieldProps {
  query: string;
  onQuery: (query: string) => void;
  groups: readonly SearchGroup[];
  opened: ReadonlySet<SearchGroupId>;
  /** the lit row (an index in visibleResults), -1: none */
  active: number;
  onActive: (index: number) => void;
  onOpen: (result: SearchResult) => void;
}

/** The field: a combobox over the results below the tabs. */
export function ConnectAppsSearchField({ query, onQuery, groups, opened, active, onActive, onOpen }: ConnectAppsSearchFieldProps) {
  const rows = visibleResults(groups, opened);
  const searching = query.trim() !== "";
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!searching) return;
      event.preventDefault();
      onActive(moveActive(active, rows.length, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Enter") {
      if (!searching) return;
      event.preventDefault();
      const row = rows[active >= 0 ? active : 0];
      if (row) onOpen(row);
      return;
    }
    if (event.key === "Escape" && query !== "") {
      // empties the field; the window steps back or closes only when it is empty
      event.preventDefault();
      event.stopPropagation();
      onQuery("");
    }
  };
  return (
    <label className={SEARCH_BOX} data-plugins-search-box>
      <Search size={15} className="shrink-0 text-ink-secondary" aria-hidden="true" />
      <input
        value={query}
        onChange={(event) => { onQuery(event.target.value); onActive(-1); }}
        onKeyDown={onKeyDown}
        placeholder={t("connectApps.search.short")}
        aria-label={t("connectApps.search.placeholder")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={searching}
        aria-controls={searching ? LISTBOX_ID : undefined}
        aria-activedescendant={searching && active >= 0 && active < rows.length ? optionId(active) : undefined}
        data-plugins-search
        className={PLUGINS.searchInput}
      />
      {query !== "" && (
        <button type="button" onClick={() => onQuery("")} aria-label={t("connectApps.search.clear")} title={t("connectApps.search.clear")} data-plugins-search-clear
          className="-mr-1 shrink-0 rounded-full p-0.5 text-ink-secondary hover:bg-hover hover:text-ink">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}

export interface ConnectAppsSearchResultsProps {
  query: string;
  groups: readonly SearchGroup[];
  opened: ReadonlySet<SearchGroupId>;
  onOpenGroup: (id: SearchGroupId) => void;
  active: number;
  onActive: (index: number) => void;
  onOpen: (result: SearchResult) => void;
  /** still reading a source: said under the results */
  loading?: boolean;
}

/** What the search found, grouped by kind. */
export function ConnectAppsSearchResults({ query, groups, opened, onOpenGroup, active, onActive, onOpen, loading = false }: ConnectAppsSearchResultsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector(`#${optionId(active)}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  let index = -1;
  return (
    <div ref={listRef} id={LISTBOX_ID} role="listbox" aria-label={t("connectApps.search.resultsAria")} data-plugins-search-results>
      {groups.length === 0 ? (
        <p className="mt-2 rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary" role="status" data-plugins-search-empty>
          {loading ? t("connectors.loadingCatalog") : t("connectApps.search.empty", { query: query.trim() })}
        </p>
      ) : groups.map((group) => {
        const shown = opened.has(group.id) ? group.results : group.results.slice(0, GROUP_PREVIEW);
        return (
          <section key={group.id} role="group" aria-labelledby={`connect-apps-group-${group.id}`} data-plugins-search-group={group.id} className="mb-4">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 id={`connect-apps-group-${group.id}`} className={PLUGINS.sectionTitle}>{searchGroupTitle(group.id)}</h3>
              {group.results.length > shown.length && (
                <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => onOpenGroup(group.id)} className={PLUGINS.sectionLink} data-plugins-search-more={group.id}>
                  {t("connectApps.showMore", { count: group.results.length - shown.length })}
                </button>
              )}
            </div>
            <div className={PLUGINS.grid}>
              {shown.map((result) => {
                index += 1;
                const at = index;
                return (
                  <div
                    key={result.key}
                    id={optionId(at)}
                    role="option"
                    aria-selected={active === at}
                    data-plugins-search-result={result.key}
                    data-active={active === at ? "" : undefined}
                    // the field keeps the focus (and the keyboard)
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => onActive(at)}
                    onClick={() => onOpen(result)}
                    className={cn("flex cursor-pointer items-center gap-3 rounded-2xl p-2.5", active === at ? "bg-ink/[0.07]" : "hover:bg-ink/5")}
                  >
                    <ResultRow result={result} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {loading && groups.length > 0 && <p className="text-[12px] text-ink-tertiary" role="status">{t("connectors.loadingCatalog")}</p>}
    </div>
  );
}

function ResultText({ name, nameStyle, by, line }: { name: string; nameStyle?: React.CSSProperties; by?: string; line?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px]">
        <span className="truncate font-medium text-ink" style={nameStyle}>{name}</span>
        {by && <span className="shrink-0 truncate text-ink-tertiary">{by}</span>}
      </span>
      {line && <span className="block truncate text-[12px] leading-[18px] text-ink-secondary" title={line}>{line}</span>}
    </span>
  );
}

const tile = "flex size-11 shrink-0 items-center justify-center rounded-xl bg-hover text-ink-secondary";

function ResultRow({ result }: { result: SearchResult }) {
  switch (result.kind) {
    case "item":
      return (
        <>
          <PluginIcon item={result.item} className="size-11" />
          <ResultText name={result.item.name} line={result.item.description} />
        </>
      );
    case "catalog": {
      const color = nameColor(itemLook(result.item));
      return (
        <>
          <CatalogMascot item={result.item} size={44} />
          <ResultText name={itemName(result.item)} nameStyle={color ? { color } : undefined} by={t("botCatalog.by", { name: itemCreator(result.item) })} line={itemDescription(result.item)} />
        </>
      );
    }
    case "page":
      return (
        <>
          <span className={tile} aria-hidden="true"><FileText size={18} /></span>
          <ResultText name={result.page.title} line={result.page.status} />
        </>
      );
    case "source":
      return (
        <>
          <span className={tile} aria-hidden="true">{result.source.id === "github" ? <GitBranch size={18} /> : <Store size={18} />}</span>
          <ResultText name={result.source.name} line={result.source.detail} />
        </>
      );
  }
}
