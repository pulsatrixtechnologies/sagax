// The page's pill tabs and the search behind the magnifier (#2271, split
// from BotProfilePage for #1383).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Search } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { TabIndicator, TabIndicatorGroup } from "@/components/TabIndicator";
import { personaPagesMatching } from "@/lib/persona-search";
import { applySettingsSearch, clearSettingsSearch, settingsQuery } from "@/lib/settings-search";
import type { BotProfileTab, PersonaCategory } from "@/lib/persona-sections";
import { sectionLabel, TAB_LABEL } from "./cards";

/** The search: the pages the query leads to, best first. The first one's
 * tab opens and hides its rows that do not match; the tabs of the others
 * stay plain, the rest dim. Command-F or a slash opens it from anywhere on
 * the page. */
export function useBotProfileSearch({ rootRef, pages, tabOf, view, appearanceOpen, onOpenCategory, onOpenAppearance }: {
  rootRef: RefObject<HTMLElement | null>;
  pages: readonly PersonaCategory[];
  tabOf: (id: PersonaCategory) => BotProfileTab;
  /** What is on screen (the tab and its open sub-page): the hit is marked again when it changes. */
  view: string;
  appearanceOpen: boolean;
  /** Opens the tab and the sub-page that hold a section (V6, #2612); with
   * the query, the sub-page that holds the matched option (#2623). */
  onOpenCategory: (id: PersonaCategory, query?: string) => void;
  onOpenAppearance: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = settingsQuery(query);

  const results = useMemo(() => personaPagesMatching(pages, q, sectionLabel), [pages, q]);
  const searchHit = q ? results[0] ?? null : null;
  const matching = new Set(results.filter((id) => id !== "appearance").map(tabOf));
  const changeQuery = (value: string) => {
    setQuery(value);
    const next = settingsQuery(value);
    if (!next) return;
    const first = personaPagesMatching(pages, next, sectionLabel)[0];
    if (!first) return;
    if (first === "appearance") onOpenAppearance();
    else onOpenCategory(first, next);
  };
  useLayoutEffect(() => {
    const root = searchHit ? rootRef.current?.querySelector<HTMLElement>(`[data-bot-profile-section="${searchHit}"]`) : null;
    if (!root || !q) return;
    let scroll = true;
    const apply = () => {
      const hit = applySettingsSearch(root, q);
      if (scroll && hit) hit.scrollIntoView?.({ block: "center", inline: "nearest" });
      scroll = false;
    };
    apply();
    const observer = new MutationObserver(() => apply());
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearSettingsSearch(root);
    };
  }, [q, searchHit, view, appearanceOpen]);

  const focusSearch = () =>
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  const openSearch = () => {
    setSearching(true);
    focusSearch();
  };
  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };

  // Command-F or a slash opens the search, from anywhere on the page.
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || (event.target !== document.body && !root.contains(event.target))) return;
      const find = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing;
      if (!find && !slash) return;
      event.preventDefault();
      openSearchRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Escape clears the query, then puts the field away; on the page it closes.
  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (query) {
      setQuery("");
      return;
    }
    closeSearch();
    rootRef.current?.focus({ preventScroll: true });
  };

  return { searchRef, searching, query, q, results, matching, changeQuery, openSearch, closeSearch, onSearchKey };
}

export type BotProfileSearch = ReturnType<typeof useBotProfileSearch>;

/** The pill tabs, wrapping when the window is narrow, and the search behind
 * the magnifier. */
export function BotProfileTabBar({ tabs, tab, onTab, search }: {
  tabs: readonly BotProfileTab[];
  tab: BotProfileTab;
  onTab: (tab: BotProfileTab) => void;
  search: BotProfileSearch;
}) {
  const { searchRef, searching, query, q, results, matching, changeQuery, openSearch, closeSearch, onSearchKey } = search;
  return (
    <>
      <div className="mt-5 flex items-start gap-1">
        <div
          role="tablist"
          data-bot-profile-tabs=""
          aria-label={t("botProfile.tabsAria")}
          onKeyDown={(event) => {
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!;
            onTab(next);
            event.currentTarget.querySelector<HTMLElement>(`[data-bot-profile-tab="${next}"]`)?.focus();
          }}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
        >
          <TabIndicatorGroup>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`bot-profile-tab-${id}`}
              aria-controls={`bot-profile-panel-${id}`}
              data-bot-profile-tab={id}
              data-bot-profile-tab-match={q && matching.has(id) ? "" : undefined}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => onTab(id)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                tab === id ? "text-ink" : "text-ink-secondary hover:text-ink",
                q && !matching.has(id) && "opacity-40",
              )}
            >
              {tab === id && <TabIndicator />}
              <span className="relative">{t(TAB_LABEL[id])}</span>
            </button>
          ))}
          </TabIndicatorGroup>
        </div>
        <button
          type="button"
          data-bot-profile-search-toggle=""
          aria-expanded={searching}
          aria-label={t("persona.searchAria")}
          title={t("persona.search")}
          onClick={() => (searching ? closeSearch() : openSearch())}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            searching ? "bg-hover text-ink" : "text-ink-secondary",
          )}
        >
          <Search size={15} aria-hidden="true" />
        </button>
      </div>
      {searching && (
        <div data-bot-profile-search="" className="mt-3 flex flex-col">
          <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2">
            <Search size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            <input
              ref={searchRef}
              data-persona-search=""
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={onSearchKey}
              placeholder={t("persona.search")}
              aria-label={t("persona.searchAria")}
              className="w-full bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
          {q && results.length === 0 && (
            <div data-persona-no-match="" role="status" className="px-2.5 py-3 text-[12.5px] leading-relaxed text-ink-secondary">
              {t("persona.noMatch", { query: query.trim() })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
