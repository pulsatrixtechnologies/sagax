// The page's pill tabs and the search behind the magnifier (#2271, split
// from BotProfilePage for #1383).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Search } from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { PillTabs } from "@/components/PillTabs";
import { UiMovable, useUiCustomize } from "@/components/ui-customize";
import { useUiLayout } from "@/lib/ui-layout/preference";
import { botProfileTabOrder, profileTabComponentId, profileTabFromComponentId } from "@/lib/ui-layout/bot-page-order";
import { personaPagesMatching } from "@/lib/persona-search";
import { applySettingsSearch, clearSettingsSearch, settingsQuery } from "@/lib/settings-search";
import type { BotProfileTab, PersonaCategory } from "@/lib/persona-sections";
import { sectionLabel, TAB_LABEL } from "./cards";

/** The search: the pages the query leads to, best first. The first one's
 * tab opens and hides its rows that do not match; the tabs of the others
 * stay plain, the rest dim. A hit held on a sub-page marks that sub-page's
 * row while the person types, and Enter opens its modal, its rows marked
 * (#4470: a modal opened on each key would take the field away).
 * Command-F or a slash opens it from anywhere on the page. */
export function useBotProfileSearch({ rootRef, pages, tabOf, view, onOpenCategory, rootFor }: {
  rootRef: RefObject<HTMLElement | null>;
  pages: readonly PersonaCategory[];
  tabOf: (id: PersonaCategory) => BotProfileTab;
  /** What is on screen (the tab and its open sub-page): the hit is marked again when it changes. */
  view: string;
  /** Shows the tab that holds a section (V6, #2612), with the query the
   * row of the sub-page that holds the matched option (#2623); `open` opens
   * that sub-page's modal (Enter in the field, #4470). */
  onOpenCategory: (id: PersonaCategory, query: string, open: boolean) => void;
  /** Where the hit is when it is not its section's block: a selector for
   * the query (General's Settings card for a switch held in place, #3398). */
  rootFor?: (query: string) => string | null;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = settingsQuery(query);

  const results = useMemo(() => personaPagesMatching(pages, q, sectionLabel), [pages, q]);
  const searchHit = q ? results[0] ?? null : null;
  const matching = new Set(results.map(tabOf));
  const changeQuery = (value: string) => {
    setQuery(value);
    const next = settingsQuery(value);
    if (!next) return;
    const first = personaPagesMatching(pages, next, sectionLabel)[0];
    if (!first) return;
    onOpenCategory(first, next, false);
  };
  useLayoutEffect(() => {
    const selector = searchHit ? (rootFor?.(q) ?? `[data-bot-profile-section="${searchHit}"]`) : null;
    // on the page, or on the sub-page's modal Enter opened (portalled to the body, #4470)
    const root = selector ? rootRef.current?.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(`[data-bot-page-modal] ${selector}`) : null;
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
  }, [q, searchHit, view]);

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

  // Enter opens the first hit's sub-page (#4470). Escape clears the query,
  // then puts the field away; on the page it closes.
  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing && searchHit) {
      event.preventDefault();
      onOpenCategory(searchHit, q, true);
      return;
    }
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

/** The pill tabs (the shared PillTabs, measured on the reference), wrapping
 * when the window is narrow, and the search behind the magnifier. A tab in `attention` carries the attention dot beside its
 * label (Outcomes while one of them needs the person). */
export function BotProfileTabBar({ tabs, tab, onTab, search, attention }: {
  tabs: readonly BotProfileTab[];
  tab: BotProfileTab;
  onTab: (tab: BotProfileTab) => void;
  search: BotProfileSearch;
  attention?: ReadonlySet<BotProfileTab>;
}) {
  const { searchRef, searching, query, q, results, matching, changeQuery, openSearch, closeSearch, onSearchKey } = search;
  const uiCustomize = useUiCustomize();
  const storedLayout = useUiLayout();
  const botZone = uiCustomize.active ? uiCustomize.draft.zones.botPage : storedLayout.zones.botPage;
  const offered = new Set(tabs);
  const visibleTabs = botProfileTabOrder(botZone)
    .map((id) => profileTabFromComponentId(id))
    .filter((id): id is BotProfileTab => id !== null && offered.has(id as BotProfileTab)) as BotProfileTab[];
  // Fall back to the offered list when the zone order has none left visible.
  const shownTabs = visibleTabs.length > 0 ? visibleTabs : [...tabs];
  const activeTab = shownTabs.includes(tab) ? tab : shownTabs[0] ?? tab;

  useEffect(() => {
    if (activeTab !== tab && shownTabs.includes(activeTab)) onTab(activeTab);
  }, [activeTab, tab, shownTabs, onTab]);

  const wrapTab = uiCustomize.active
    ? (id: BotProfileTab, node: ReactNode) => (
        <UiMovable
          zoneId="botPage"
          id={profileTabComponentId(id)}
          label={t(`ui.customize.item.tab.${id}` as LocaleKey)}
        >
          {node}
        </UiMovable>
      )
    : undefined;

  return (
    <>
      <div className="mt-4 flex items-start gap-1 px-1">
        {shownTabs.length > 0 ? (
          <PillTabs
            tabs={shownTabs}
            tab={activeTab}
            onTab={onTab}
            idPrefix="bot-profile"
            ariaLabel={t("botProfile.tabsAria")}
            data-bot-profile-tabs=""
            className="flex-1"
            label={(id) => t(TAB_LABEL[id])}
            wrapTab={wrapTab}
            tabAttributes={(id) => ({ "data-bot-profile-tab": id, "data-bot-profile-tab-match": q && matching.has(id) ? "" : undefined })}
            tabClassName={(id) => q && !matching.has(id) && "opacity-40"}
            after={(id) => attention?.has(id) && (
              <>
                <span data-bot-profile-tab-dot="" aria-hidden="true" className="relative size-1.5 shrink-0 rounded-full bg-warning" />
                <span className="sr-only">{t("botTasks.waiting")}</span>
              </>
            )}
          />
        ) : <div className="flex-1" />}
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
            <div data-persona-no-match="" role="status" className="px-2.5 py-3 text-[12px] leading-relaxed text-ink-secondary">
              {t("persona.noMatch", { query: query.trim() })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
