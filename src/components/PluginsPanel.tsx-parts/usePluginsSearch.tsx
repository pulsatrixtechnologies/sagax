import { useEffect, useMemo, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { catalogSections, type CatalogItem } from "@/lib/bot-catalog";
import { searchConnectApps, visibleResults, type SearchPage, type SearchResult, type SearchSource } from "@/lib/connect-apps-search";
import { ConnectAppsSearchField, ConnectAppsSearchResults } from "../plugins/ConnectAppsSearch";
import type { PublishedPageSummary } from "../../../shared/published-pages";
import { accountConnectorSub, type AccountConnectorRow, type HarnessConnectorGroup } from "../plugins/HarnessConnectorGroups";
import type { PluginsPanelState } from "./usePluginsPanelState";
import type { PluginsPanelActions } from "./usePluginsPanelActions";

/** The one search of the Plugins shell: its field, its results and what a result opens. */
export function usePluginsSearch(
  s: PluginsPanelState,
  a: PluginsPanelActions,
  accountSections: { group: HarnessConnectorGroup; rows: AccountConnectorRow[] }[],
) {
  const {
    mcp, botSources, setBotFocus, search, setSearch, openedGroups, setOpenedGroups, activeResult,
    setActiveResult, setFilter, setType, setTab, scopedItems, revealLater, chooseTab,
  } = s;
  const { openItem, githubHere, openGithub, marketSummaries } = a;
  // The one search (2026-10-29): every plugin, app, skill and server of the
  // scope, Browse Bots' bots and templates, the published pages and the
  // sources. The pages are read the first time the search has text.
  const searching = search.trim() !== "";
  const [searchPages, setSearchPages] = useState<SearchPage[] | null>(null);
  useEffect(() => {
    if (!searching || searchPages !== null) return;
    let alive = true;
    api<{ pages: PublishedPageSummary[] }>("/api/pages")
      .then((answer) => {
        if (!alive) return;
        setSearchPages(answer.pages.map((entry) => ({
          id: entry.id,
          title: entry.title,
          status: entry.status === "published" ? (entry.expired ? t("pages.status.expired") : t("pages.status.published")) : entry.status === "revoked" ? t("pages.status.revoked") : t("pages.status.draft"),
        })));
      })
      .catch(() => { if (alive) setSearchPages([]); });
    return () => { alive = false; };
  }, [searching, searchPages]);
  const catalogItems = useMemo<CatalogItem[]>(
    () => catalogSections(botSources.data ?? { organization: false, entries: [] }, botSources.templates, { category: "all", query: "", showArchived: true, app: null }).flatMap((section) => section.items),
    [botSources.data, botSources.templates],
  );
  const searchSources: SearchSource[] = [
    ...(githubHere ? [{ id: "github", name: t("myConnections.github.title") }] : []),
    ...(marketSummaries ?? []).map((market) => ({ id: `market:${market.name}`, name: market.name, detail: market.source })),
  ];
  const searchGroups = searching ? searchConnectApps({
    query: search,
    // a Grok connector is found as its account row (#2306)
    items: scopedItems.filter((item) => item.source !== "grok"),
    catalog: catalogItems,
    pages: searchPages ?? [],
    sources: searchSources,
    accounts: accountSections.flatMap(({ rows }) => rows.map((row) => ({ key: row.key, name: row.name, detail: accountConnectorSub(row) }))),
  }) : [];
  const searchLoading = searching && (searchPages === null || mcp.servers === null || (!botSources.data && !botSources.loadFailed));
  const changeSearch = (value: string) => {
    setSearch(value);
    setActiveResult(-1);
    setOpenedGroups(new Set());
  };
  /** A result: its page, or its tab with it in view. The search empties. */
  const openResult = (result: SearchResult) => {
    changeSearch("");
    if (result.kind === "item") {
      const item = result.item;
      if (item.installed || item.kind === "plugin" || item.kind === "skill") {
        chooseTab(item.installed ? "installed" : "discover");
        openItem(item);
        return;
      }
      // not added yet: Discover, on its category, the row in view
      chooseTab("discover");
      setFilter(item.category);
      setType("any");
      revealLater(`[data-plugin-row="${CSS.escape(item.key)}"]`);
      return;
    }
    if (result.kind === "catalog") {
      chooseTab("bots");
      setBotFocus({ key: result.item.key, nonce: Date.now() });
      return;
    }
    if (result.kind === "account") {
      // its row in Discover's "From <provider>", in view
      chooseTab("discover");
      setFilter("all");
      setType("any");
      revealLater(`[data-plugin-row="${CSS.escape(result.key)}"]`);
      return;
    }
    if (result.kind === "page") {
      chooseTab("pages");
      revealLater(`[data-published-page="${CSS.escape(result.page.id)}"]`);
      return;
    }
    if (result.source.id === "github") {
      setTab("sources");
      openGithub();
      return;
    }
    chooseTab("sources");
    revealLater(`[data-marketplace="${CSS.escape(result.source.name)}"]`);
  };
  const searchRows = visibleResults(searchGroups, openedGroups);
  const searchField = (
    <ConnectAppsSearchField
      query={search}
      onQuery={changeSearch}
      groups={searchGroups}
      opened={openedGroups}
      active={activeResult < searchRows.length ? activeResult : -1}
      onActive={setActiveResult}
      onOpen={openResult}
    />
  );
  const searchResults = searching ? (
    <ConnectAppsSearchResults
        query={search}
        groups={searchGroups}
        opened={openedGroups}
        onOpenGroup={(id) => setOpenedGroups((current) => new Set([...current, id]))}
        active={activeResult < searchRows.length ? activeResult : -1}
        onActive={setActiveResult}
        onOpen={openResult}
        loading={searchLoading}
      />
  ) : undefined;
  return { searchField, searchResults };
}
