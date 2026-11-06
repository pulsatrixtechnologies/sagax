import type { Place, TrashRow } from "./memory-manager-types";
import { useMemoryRows } from "./useMemoryRows";
import { useMemoryManagerLoad } from "./useMemoryManagerLoad";
import { useMemoryManagerActions } from "./useMemoryManagerActions";
import { useMemoryExplorer } from "./useMemoryExplorer";
import { useMemoryManagerDerived } from "./useMemoryManagerDerived";
import { memoryScopeKey, readMemoryScope, writeMemoryScope, type MemoryView } from "./memory-manager-scope";
import { readPins } from "./memory-manager-helpers";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, CircleCheck, FileText, FolderInput, Gauge, Network, Plus, RefreshCw, Tag, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import type { MemoryJournalRow } from "@/lib/memory";
import { useStore } from "@/state/store";
import type { MemoryBrowse, MemoryManagerSource, MemoryNoteDetail, MemoryNoteRow, MemoryVocabulary } from "@/lib/memory-manager";
import type { PageRow } from "@/lib/memory-page";
import type { LinkBot } from "@/lib/memory-folders";
import { useCaptionChrome } from "../DesktopCapabilities";
import { PAGE_HEADER_BUTTON, PAGE_MENU_ITEM, PAGE_POPOVER, PageHeader, PageSegment, PageTopStrip, useDismissMenus } from "../content-page";
import { fetchCollections, MemoryCollections, type CollectionItem, type CollectionSummary } from "./MemoryCollections";
import { MemoryMapView } from "./MemoryMapView";
import { MemoryNotesList } from "./MemoryNotesList";
import { MemoryQualityView } from "./MemoryQualityView";
import { RightRailStrip, useRightRailOpen } from "@/components/RightRail";
import { MemorySidebar } from "./MemorySidebar";
import { MemoryTagsView } from "./MemoryTagsView";
import { PRIMARY_BUTTON } from "./memory-ui";
import { MemoryManagerReading } from "./MemoryManagerReading";

// Tools > Memory: a full page of the main column (Automations / Team map
// family), shaped like the Perspicax console's Memory (1.9.20, JC
// 2026-11-02: "la page des mémoires devrait être presque identique"). The
// header row is Automations' (content-page.tsx) with the views under the
// title: Notes | Map | Tags | Quality, "+ New note" and the ⋯ menu on the
// right. Notes puts the console's explorer in the page's RIGHT rail, the
// same piece as Automations' calendar rail (RightRail.tsx, JC 2026-11-03),
// and the list to its left (MemoryNotesList.tsx); a note, its preview or its
// page (MemoryNoteView.tsx), takes the list's place in the content, left of
// the rail, which stays usable. Every source shows: each bot's memory (a folder of
// My memory with its Topics and Logs), the team sections (General and its
// built-in groups as folders) and, on a Perspicax organization server, the
// Perspicax tiers. Every number is one Sagax reads; nothing is made up.

export { memoryScopeKey, readMemoryScope, writeMemoryScope } from "./memory-manager-scope";

type View = MemoryView;

type Screen =
  | { kind: "list" }
  | { kind: "note"; key: string; edit?: boolean }
  | { kind: "create" }
  | { kind: "move"; keys: string[] };

interface Notice {
  text: string;
  undo?: () => Promise<void>;
}

/** Full-page Memory (main column). */
export function MemoryManagerPanel() {
  const { state, dispatch } = useStore();
  const linkBots = state.bots as unknown as LinkBot[];
  const linkRoutines = state.routines;
  const { dragProps, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const close = useCallback(() => dispatch({ type: "toggleMemoryManager", open: false }), [dispatch]);
  const mac = useMemo(() => isMacPlatform(), []);

  const scopeKey = memoryScopeKey(state.config?.viewer?.principalId);
  const [initialScope] = useState(() => readMemoryScope(scopeKey));
  const [view, setView] = useState<View>(initialScope.view);
  const [place, setPlace] = useState<Place>(initialScope.place);
  const scopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    const mine = readMemoryScope(scopeKey);
    setView(mine.view);
    setPlace(mine.place);
  }, [scopeKey]);
  useEffect(() => { writeMemoryScope(scopeKeyRef.current, view, place); }, [view, place]);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [sources, setSources] = useState<MemoryManagerSource[] | null>(null);
  const [overviews, setOverviews] = useState<Record<string, MemoryBrowse>>({});
  const [overviewsReady, setOverviewsReady] = useState(false);
  const [journals, setJournals] = useState<Record<string, MemoryJournalRow[]>>({});
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [archivedRaw, setArchivedRaw] = useState<MemoryNoteRow[]>([]);
  const [vocabulary, setVocabulary] = useState<MemoryVocabulary | null>(null);
  const [trashRaw, setTrashRaw] = useState<TrashRow[]>([]);
  const [pxReason, setPxReason] = useState<string | undefined>();
  const [note, setNote] = useState<MemoryNoteDetail | null>(null);
  const [noteEntry, setNoteEntry] = useState<PageRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pins, setPins] = useState<string[]>(() => (typeof window === "undefined" ? [] : readPins()));
  const [createTarget, setCreateTarget] = useState("");
  const [createFolder, setCreateFolder] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createBody, setCreateBody] = useState("");
  const [newFolder, setNewFolder] = useState(false);
  const [moveTopic, setMoveTopic] = useState("notes");
  const [moveScope, setMoveScope] = useState("me");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState("");
  const [listQuery, setListQuery] = useState<string | undefined>();
  const [mapFocus, setMapFocus] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ entry: PageRow; detail: MemoryNoteDetail | null } | null>(null);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [collectionItems, setCollectionItems] = useState<Record<string, CollectionItem[]>>({});
  const [openCollection, setOpenCollection] = useState<{ id: string; title: string } | null>(null);
  const [explorerOpen, setExplorerOpen] = useRightRailOpen();
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const listScrollTop = useRef(0);
  const switcherRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  useDismissMenus([menuRef]);
  const bodiesRequested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const { loadSources, refresh } = useMemoryManagerLoad({
    setSources, setOverviews, setOverviewsReady, setJournals, setArchivedRaw, setVocabulary,
    setTrashRaw, setCollections, setPxReason, setError, bodiesRequested,
  }, sources);
  useEffect(() => { void loadSources(); }, [loadSources]);

  const { pxSource, pxTiers, botSources, teamSources, meTier, tiers, tierByKey, pxTierKey, factsByBot, rows, rowByKey, archivedRows, pxTrashRows, trashRows, counts, placeRows } = useMemoryRows({ sources, overviews, journals, bodies, archivedRaw, trashRaw, pins, place, openCollection, collections, collectionItems, overviewsReady, setBodies, bodiesRequested, mounted, setCollectionItems, setOpenCollection });

  const {
    goPlace, openPreview, previewKey, openNote, openKey, togglePin, saveNote,
    deleteKeys, restoreKeys, emptyTrash, targets, defaultTarget, startCreate, createNote, startMove,
    runMove, renamePxFolder, deletePxFolder, deleteBotFolder, folderMenu, linkTitle, reorder, collect
  } = useMemoryManagerActions({
    sources, overviews, pxSource, pxTiers, botSources, teamSources, meTier, rows, rowByKey,
    archivedRows, trashRows, pxTrashRows, place, screen, note, noteEntry, createTarget, createFolder,
    createTitle, createBody, moveTopic, moveScope, collections, pxTierKey, refresh,
    setPlace, setScreen, setView, setPreview, setNote, setNoteEntry, setBusy, setError, setNotice,
    setPins, setBodies, setCreateTarget, setCreateFolder, setCreateTitle, setCreateBody, setNewFolder,
    setMoveTopic, setMoveScope, setListQuery, setCollectionItems, setCollections,
  });

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) setPreview(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);
  const readingPage = screen.kind === "note" && !preview;
  useEffect(() => {
    if (!readingPage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      setScreen({ kind: "list" });
      setNote(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readingPage]);
  const listShown = screen.kind === "list" && !preview;
  useLayoutEffect(() => {
    if (listShown && listScrollRef.current) listScrollRef.current.scrollTop = listScrollTop.current;
  }, [listShown]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.shiftKey || event.altKey || !(mac ? event.metaKey : event.ctrlKey) || event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      setView("notes");
      setExplorerOpen(true);
      setSwitcherOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mac, setExplorerOpen]);
  useEffect(() => {
    if (switcherOpen) requestAnimationFrame(() => switcherRef.current?.focus());
    else setSwitcherQuery("");
  }, [switcherOpen]);

  const { lists, tidy, explorerTiers, switcher, explorerLoading, explorerFooter } = useMemoryExplorer({
    sources, overviews, overviewsReady, pxSource, pxTiers, botSources, teamSources, meTier, tiers, tierByKey,
    rows, counts, archivedRows, trashRows, collections, place, pins, targets, switcherOpen, switcherQuery,
    switcherRef, linkBots, linkRoutines, pxReason, goPlace, startCreate, setRenaming, setImportOpen,
    setSwitcherOpen, setSwitcherQuery, openNote, renamePxFolder, deletePxFolder, deleteBotFolder, folderMenu, linkTitle,
  });
  const {
    listTitle, listLine, templates, fromTemplate, canNewHere, noteTier, noteLinks, previewLinks,
    scoped, scopeRows, scopeTiers, stats, scopeJournal, scopeReview, quality, active, writes, scopeLabel,
    importDestinations, importWriters, loading, createTargetRow,
  } = useMemoryManagerDerived({
    place, tiers, tierByKey, rows, botSources, rowByKey, defaultTarget, startCreate, setError,
    note, noteEntry, preview, bodies, placeRows, vocabulary, journals, pxSource, pxTiers,
    archivedRows, counts, openCollection, targets, sources, overviewsReady, createTarget,
  });

  // ---- render ----------------------------------------------------------------------------

  const viewOptions = [
    { value: "notes" as const, label: t("memoryManager.viewNotes"), icon: FileText },
    { value: "map" as const, label: t("memoryManager.viewMap"), icon: Network },
    { value: "tags" as const, label: t("memoryManager.viewTags"), icon: Tag },
    { value: "quality" as const, label: t("memoryManager.viewQuality"), icon: Gauge },
  ];

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink" data-memory-manager-page="" data-memory-manager-panel="">
      <PageTopStrip />
      <PageHeader
        name="memory"
        icon={Brain}
        title={t("memoryManager.title")}
        large
        {...dragProps}
        topbar
        style={dragProps.style}
        actionsStyle={{ ...noDragStyle, ...controlsShiftStyle }}
        actions={<>
          {targets.length > 0 && (
            <button type="button" data-memory-create="" className={cn(PRIMARY_BUTTON, "h-9 px-3.5")} onClick={() => startCreate()} title={t("memoryManager.newNote")}>
              <Plus size={15} aria-hidden="true" /><span className="@max-[30rem]/page-header:sr-only">{t("memoryManager.newNote")}</span>
            </button>
          )}
          <details ref={menuRef} className="relative" data-memory-menu="">
            <summary aria-label={t("memoryManager.more")} title={t("memoryManager.more")} className={PAGE_HEADER_BUTTON}>
              <span aria-hidden="true" className="text-[16px] leading-none">⋯</span>
            </summary>
            <div role="menu" className={cn(PAGE_POPOVER, "w-[240px] gap-0.5 p-1.5")}>
              <button type="button" role="menuitem" className={PAGE_MENU_ITEM} onClick={() => { menuRef.current?.removeAttribute("open"); refresh(); }} data-memory-refresh="">
                <RefreshCw size={16} />{t("memoryManager.refresh")}
              </button>
              <button type="button" role="menuitem" className={PAGE_MENU_ITEM} onClick={() => { menuRef.current?.removeAttribute("open"); goPlace({ kind: "review" }, true); }}>
                <CircleCheck size={16} />{t("memoryManager.proposals")}
                {counts.review > 0 && <span className="ml-auto rounded-full bg-raised px-1.5 text-[11px] text-ink-secondary">{counts.review}</span>}
              </button>
              {importDestinations.length > 0 && (
                <button type="button" role="menuitem" className={PAGE_MENU_ITEM} onClick={() => { menuRef.current?.removeAttribute("open"); setImportOpen(true); }} data-memory-import-open="">
                  <FolderInput size={16} />{t("memoryManager.import.open")}
                </button>
              )}
              {(pxSource || trashRows.length > 0) && (
                <button type="button" role="menuitem" className={PAGE_MENU_ITEM} onClick={() => { menuRef.current?.removeAttribute("open"); goPlace({ kind: "trash" }, true); }}>
                  <Trash2 size={16} />{t("memoryManager.nav.trash")}
                </button>
              )}
            </div>
          </details>
          <button type="button" aria-label={t("memoryManager.close")} title={t("memoryManager.close")} className={PAGE_HEADER_BUTTON} onClick={close}>
            <X size={16} />
          </button>
        </>}
        below={(
          <div className="mt-3 space-y-2" style={noDragStyle}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex" data-memory-views="">
                <PageSegment label={t("memoryManager.viewLabel")} value={view} onChange={(next) => { setView(next); if (next !== "map") setMapFocus(null); }} options={viewOptions} />
              </div>
              {scoped && (
                <span className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-full border border-hairline/60 bg-raised pl-2.5 pr-1 text-[12.5px] text-ink" data-memory-scope-chip="">
                  <span className="truncate">{t("memoryManager.scope", { scope: scopeLabel })}</span>
                  <button type="button" aria-label={t("memoryManager.scopeClear")} title={t("memoryManager.scopeClear")} className="grid size-5 shrink-0 place-items-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink" onClick={() => goPlace({ kind: "all" })} data-memory-scope-clear="">
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
            {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
            {notice && (
              <div className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2 text-[12.5px] text-ink" data-memory-notice="">
                <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
                <span className="min-w-0 flex-1">{notice.text}</span>
                {notice.undo && (
                  <button type="button" className="text-accent-text hover:underline" onClick={() => void notice.undo?.().then(() => setNotice(null))}>
                    {t("common.undo")}
                  </button>
                )}
                <button type="button" aria-label={t("common.close")} onClick={() => setNotice(null)} className="text-ink-tertiary hover:text-ink">
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
        )}
      />

      <div data-memory-row="" className="relative flex min-h-0 min-w-0 flex-1">
        <div className="content-card-body flex min-h-0 min-w-0 flex-1">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-memory-content="">
            {view === "map" && (
              <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", preview && "hidden")} data-memory-map-view="">
                <MemoryMapView rows={scopeRows} tiers={scopeTiers} bodies={bodies} review={scopeReview} focusKey={mapFocus} onOpen={previewKey} onOpenNote={(key) => openKey(key)} onNew={targets.length ? () => startCreate() : undefined} />
              </div>
            )}
            {view === "tags" && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MemoryTagsView stats={stats} vocabulary={vocabulary} onTag={(tag) => { goPlace(place, true); setListQuery(`tag:${/\s/.test(tag) ? `"${tag}"` : tag}`); }} />
              </div>
            )}
            {view === "quality" && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MemoryQualityView
                  stats={quality}
                  tiers={scopeTiers}
                  active={active}
                  writes={writes}
                  journal={scopeJournal}
                  botName={(botId) => botSources.find((source) => source.botId === botId)?.name ?? ""}
                  onOpenPath={(botId, path) => openKey(`bot:${botId}|${path}`)}
                />
              </div>
            )}
            {view === "notes" && (
              // The list stays mounted while a note is read, so Back finds it as it was.
              <div ref={listScrollRef} onScroll={(event) => { listScrollTop.current = event.currentTarget.scrollTop; }} className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5", (screen.kind !== "list" || preview) && "hidden")} data-memory-list-scroll="">
                {place.kind === "collections" && (
                  <div data-memory-nav-view="collections">
                    <MemoryCollections
                      openId={openCollection?.id}
                      onOpenNote={(scope, id) => previewKey(`perspicax|${scope}/${id}`)}
                      onChanged={() => void fetchCollections().then(setCollections).catch(() => undefined)}
                      onSelect={(picked) => {
                        setOpenCollection(picked ? { id: picked.id, title: picked.title } : null);
                        if (picked) setCollectionItems((current) => ({ ...current, [picked.id]: picked.items }));
                      }}
                    />
                  </div>
                )}
                {place.kind !== "collections" && (
                  <div data-memory-nav-view={place.kind} data-memory-browse={place.kind === "folder" || place.kind === "tier" ? "" : undefined}>
                    <MemoryNotesList
                      key={JSON.stringify(place)}
                      title={listTitle}
                      line={listLine}
                      rows={placeRows}
                      archived={place.kind === "archived" || place.kind === "trash" ? [] : archivedRows.filter((entry) => place.kind === "all" || placeRows.some((row) => row.tier === entry.tier))}
                      tiers={tiers}
                      bodies={bodies}
                      fixedView={place.kind === "archived" || place.kind === "trash"}
                      canSelect={(entry) => (place.kind === "trash" ? entry.row.status !== "locked" : place.kind === "archived" ? true : entry.source.mayWrite)}
                      emptyText={loading ? t("memoryManager.loading") : place.kind === "trash" ? t("memoryManager.trashEmpty") : place.kind === "pinned" ? t("memoryManager.pinnedEmpty") : t("memoryManager.emptyView")}
                      onOpen={(entry) => { if (!entry.row.archived) void openPreview(entry); }}
                      onEdit={(entry) => void openNote(entry, true)}
                      onNewHere={canNewHere ? () => { const { target, folder } = defaultTarget(); startCreate(target, folder); } : undefined}
                      templates={templates}
                      onFromTemplate={canNewHere ? (template) => void fromTemplate(template) : undefined}
                      onDelete={place.kind === "archived" || place.kind === "trash" ? undefined : (keys) => void deleteKeys(keys)}
                      onMove={place.kind === "archived" || place.kind === "trash" ? undefined : startMove}
                      onRestore={place.kind === "archived" || place.kind === "trash" ? (keys) => void restoreKeys(keys) : undefined}
                      headExtra={place.kind === "trash" && pxTrashRows.some((entry) => entry.row.status !== "locked") ? (
                        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline/60 px-2.5 text-[12.5px] text-ink hover:bg-hover" onClick={() => void emptyTrash()} data-memory-trash-empty="">
                          <Trash2 size={14} aria-hidden="true" />{t("memoryManager.emptyTrash")}
                        </button>
                      ) : undefined}
                      busy={busy}
                      loading={loading}
                      initialQuery={listQuery}
                      onReorder={place.kind === "folder" && place.folder.startsWith("px:") ? reorder : undefined}
                      collections={collections.filter((entry) => entry.may_edit)}
                      onAddToCollection={(keys, collection) => void collect(keys, collection)}
                    />
                    {place.kind === "trash" && <div data-memory-trash="" />}
                  </div>
                )}
              </div>
            )}
            <MemoryManagerReading
              view={view}
              screen={screen}
              preview={preview}
              note={note}
              noteEntry={noteEntry}
              busy={busy}
              pins={pins}
              targets={targets}
              createTarget={createTarget}
              createFolder={createFolder}
              createTitle={createTitle}
              newFolder={newFolder}
              createTargetRow={createTargetRow}
              moveScope={moveScope}
              moveTopic={moveTopic}
              pxTiers={pxTiers}
              meTier={meTier}
              importOpen={importOpen}
              importDestinations={importDestinations}
              importWriters={importWriters}
              noteTier={noteTier}
              noteLinks={noteLinks}
              previewLinks={previewLinks}
              factsByBot={factsByBot}
              tierByKey={tierByKey}
              rowByKey={rowByKey}
              setScreen={setScreen}
              setNote={setNote}
              setPreview={setPreview}
              setCreateTarget={setCreateTarget}
              setCreateFolder={setCreateFolder}
              setCreateTitle={setCreateTitle}
              setMoveScope={setMoveScope}
              setMoveTopic={setMoveTopic}
              setImportOpen={setImportOpen}
              setMapFocus={setMapFocus}
              setView={setView}
              setNotice={setNotice}
              togglePin={togglePin}
              saveNote={saveNote}
              deleteKeys={deleteKeys}
              startMove={startMove}
              createNote={createNote}
              runMove={runMove}
              openNote={openNote}
              openKey={openKey}
              previewKey={previewKey}
              refresh={refresh}
            />
          </section>

          {/* The right rail, after the content (RightRail.tsx, as Automations). */}
          {explorerOpen ? (
            <MemorySidebar
              shortcut={mac ? "⌘O" : "Ctrl+O"}
              onOpenSwitcher={() => setSwitcherOpen((open) => !open)}
              switcher={switcher}
              lists={lists}
              tiers={explorerTiers}
              tidy={tidy}
              renaming={renaming}
              onRenameDone={() => setRenaming(null)}
              loading={explorerLoading}
              footer={explorerFooter}
              onCollapse={() => setExplorerOpen(false)}
            />
          ) : (
            <RightRailStrip onOpen={() => setExplorerOpen(true)} showLabel={t("memoryManager.explorerShow")} icon={<Brain size={16} aria-hidden="true" />} text={t("memoryManager.sidebarLabel")} data-memory-explorer-show="" />
          )}
        </div>
      </div>
    </main>
  );
}
