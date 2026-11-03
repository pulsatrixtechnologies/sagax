import type { Place, TrashRow } from "./memory-manager-types";
import { tierSource } from "./memory-manager-data";
import { useMemoryRows } from "./useMemoryRows";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Archive, BookOpen, Brain, Check, CircleCheck, Clock3, FileText, FolderInput, Gauge, Loader2, Network, NotebookText, Pin, Plus, RefreshCw, Tag, Trash2, Users, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { readableError } from "@/lib/plain-error";
import { fetchMemoryJournal, type MemoryJournalRow } from "@/lib/memory";
import { api, ApiError, useStore } from "@/state/store";
import { browseBotSource, browsePerspicax, browseTeamSource, deleteBotNotes, detectBodyKind, emptyBotFolder, fetchMemoryManagerSources, fetchPerspicaxArchived, fetchPerspicaxVocabulary, openBotNote, openPerspicaxNote, openTeamNote, pxMemory, restoreBotChange, saveBotNote, undoBotDeletes, type MemoryBrowse, type MemoryManagerSource, type MemoryNoteDetail, type MemoryNoteRow, type MemoryTierRow, type MemoryVocabulary } from "@/lib/memory-manager";
import { activeSeries, backlinksTo, linksOut, qualityStats, rowKey, tagStats, writeSeries, type PageLink, type PageRow } from "@/lib/memory-page";
import { MEMORY_INDEX } from "@/lib/memory";
import { botNames, botSourceLink, isLinked, pxFolderLink, teamFolderLink, type FolderLink, type LinkBot } from "@/lib/memory-folders";
import type { ImportWriters } from "@/lib/memory-import";
import { swatchStyle, type MausColor } from "@/lib/mascot";
import { useCaptionChrome } from "../DesktopCapabilities";
import { PAGE_HEADER_BUTTON, PAGE_MENU_ITEM, PAGE_POPOVER, PageHeader, PageSegment, PageTopStrip, useDismissMenus } from "../content-page";
import { confirmAsync } from "../ConfirmProvider";
import { MemoryImportDialog, type ImportDestination } from "./MemoryImportDialog";
import { addToCollection, fetchCollections, MemoryCollections, type CollectionItem, type CollectionSummary } from "./MemoryCollections";
import { MemoryMapView } from "./MemoryMapView";
import { MemoryNoteView, type NoteSave } from "./MemoryNoteView";
import { MemoryNotesList, type ListTemplate } from "./MemoryNotesList";
import { MemoryQualityView } from "./MemoryQualityView";
import { RightRailStrip, useRightRailOpen } from "@/components/RightRail";
import { MemorySidebar, type MemoryFolderMenu, type MemoryRowAction, type MemorySidebarFolder, type MemorySidebarNav, type MemorySidebarTier } from "./MemorySidebar";
import { MemoryTagsView } from "./MemoryTagsView";
import { FIELD, PRIMARY_BUTTON, Swatch } from "./memory-ui";

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

type View = "notes" | "map" | "tags" | "quality";

type Screen =
  | { kind: "list" }
  | { kind: "note"; key: string; edit?: boolean }
  | { kind: "create" }
  | { kind: "move"; keys: string[] };

interface Notice {
  text: string;
  undo?: () => Promise<void>;
}

/** A place a new note can go: a bot, a team section, a Perspicax tier. */
interface Target {
  id: string;
  label: string;
  source: MemoryManagerSource;
  /** Team sections: their built-in groups; Perspicax tiers: their folders. */
  folders: string[];
  freeFolder: boolean;
}

const TEAM_KINDS = ["person", "place", "decision", "term"];
const PINS = "sagax.memory.pins";

function slugify(value: string, fallback: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}

function readPins(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PINS) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function writePins(pins: string[]): void {
  try { window.localStorage.setItem(PINS, JSON.stringify(pins)); } catch { /* a private window: the pins last for this page */ }
}

/** A linked folder's mark: the bot's picture, else its colour. */
function LinkMark({ bot }: { bot: LinkBot }) {
  if (bot.avatarUrl && bot.avatarCrop !== "mascot") {
    return <img src={bot.avatarUrl} alt="" className="size-[14px] shrink-0 rounded-full object-cover" data-memory-link-mark="avatar" />;
  }
  return <span className="mx-[2px] size-[10px] shrink-0 rounded-full" style={swatchStyle((bot.color ?? "green") as MausColor)} aria-hidden="true" data-memory-link-mark="color" />;
}

/** The ⋯ menu's first lines: who the folder belongs to and what uses it. */
function linkLines(link: FolderLink): string[] {
  if (!isLinked(link)) return [link.readBy.length ? t("memoryManager.readBy", { bots: link.readBy.join(", ") }) : t("memoryManager.notLinkedLine")];
  return [
    t("memoryManager.linkedTo", { bot: botNames(link) }),
    ...(link.routines.length ? [t("memoryManager.routinesLine", { names: link.routines.join(", ") })] : []),
  ];
}

// The rail's selection scopes the four views and lasts across a reload
// (JC 2026-11-03), with the tab it was on.
// 2026-11-03 (audit N-5): one key per person, so on a shared browser the
// next person never inherits a selection (and an empty view): a person with
// nothing kept gets All. Without a signed-in person (solo, one person per
// machine) the plain key stays.
const SCOPE_KEY = "sagax.memory.scope";
export function memoryScopeKey(principalId: string | null | undefined): string {
  const id = principalId?.trim();
  return id ? `${SCOPE_KEY}:${id}` : SCOPE_KEY;
}
const VIEWS: readonly View[] = ["notes", "map", "tags", "quality"];
const LIST_PLACES = ["all", "teams", "pinned", "recent", "review", "archived", "trash", "collections"];

export function readMemoryScope(key: string): { view: View; place: Place } {
  const fallback = { view: "notes" as View, place: { kind: "all" } as Place };
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as { view?: unknown; place?: { kind?: unknown; tier?: unknown; folder?: unknown } } | null;
    if (!value || typeof value !== "object") return fallback;
    const view = VIEWS.includes(value.view as View) ? value.view as View : "notes";
    const raw = value.place;
    let place: Place = { kind: "all" };
    if (raw && typeof raw.kind === "string") {
      if (LIST_PLACES.includes(raw.kind)) place = { kind: raw.kind as "all" };
      else if (raw.kind === "tier" && typeof raw.tier === "string") place = { kind: "tier", tier: raw.tier };
      else if (raw.kind === "folder" && typeof raw.tier === "string" && typeof raw.folder === "string") place = { kind: "folder", tier: raw.tier, folder: raw.folder };
    }
    return { view, place };
  } catch {
    return fallback;
  }
}

export function writeMemoryScope(key: string, view: View, place: Place) {
  try { window.localStorage.setItem(key, JSON.stringify({ view, place })); } catch { /* a private window: the scope lasts for this page */ }
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
  // the person became known (or changed): their own selection, else All
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
  // The console's preview: a click on a row opens the note beside the list.
  const [preview, setPreview] = useState<{ entry: PageRow; detail: MemoryNoteDetail | null } | null>(null);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  // Each collection's notes, loaded once the Collections scope is picked and
  // kept (a save or an add refreshes its entry); the one opened, if any.
  const [collectionItems, setCollectionItems] = useState<Record<string, CollectionItem[]>>({});
  const [openCollection, setOpenCollection] = useState<{ id: string; title: string } | null>(null);
  // The explorer opens as Automations' calendar rail does (RightRail.tsx):
  // open from 1280px, folded into its strip below, a press away either way.
  const [explorerOpen, setExplorerOpen] = useRightRailOpen();
  // The list keeps its place while a note is read: its scroll is kept here.
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const listScrollTop = useRef(0);
  const switcherRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  useDismissMenus([menuRef]);
  const bodiesRequested = useRef(new Set<string>());
  // The bodies load across renders (each batch changes the rows): only an unmounted page drops them.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // ---- loading -------------------------------------------------------------------------

  const loadOverviews = useCallback(async (list: MemoryManagerSource[]) => {
    // A bot whose memory routes refuse this person (404 "no such bot", 403)
    // is not theirs to open: it leaves the page. The server already leaves such bots out.
    const refused = new Set<string>();
    const entries = await Promise.all(list.map(async (source) => {
      try {
        if (source.kind === "bot" && source.botId) return [source.id, await browseBotSource(source.botId)] as const;
        if (source.kind === "team") return [source.id, await browseTeamSource(source.section ?? "")] as const;
        if (source.kind === "perspicax") return [source.id, await browsePerspicax()] as const;
      } catch (cause) {
        if (source.kind === "bot" && cause instanceof ApiError && (cause.status === 404 || cause.status === 403)) refused.add(source.id);
      }
      return null;
    }));
    const next: Record<string, MemoryBrowse> = {};
    for (const entry of entries) if (entry) next[entry[0]] = entry[1];
    if (refused.size) setSources((current) => current?.filter((source) => !refused.has(source.id)) ?? current);
    setOverviews(next);
    setOverviewsReady(true);
    // The bots' journals: who wrote each file last, when it was created, its versions.
    const botIds = list.filter((source) => source.kind === "bot" && source.botId && !refused.has(source.id)).map((source) => source.botId!);
    const journalEntries = await Promise.all(botIds.map(async (botId) => {
      try { return [botId, (await fetchMemoryJournal(botId, 200)) ?? []] as const; } catch { return [botId, []] as const; }
    }));
    setJournals(Object.fromEntries(journalEntries));
    const px = list.find((source) => source.kind === "perspicax");
    if (px && next[px.id]) {
      void fetchPerspicaxArchived().then(setArchivedRaw).catch(() => setArchivedRaw([]));
      void fetchPerspicaxVocabulary().then(setVocabulary).catch(() => setVocabulary(null));
      void pxMemory<{ notes?: TrashRow[] }>("/trash").then((result) => setTrashRaw(result.notes ?? [])).catch(() => setTrashRaw([]));
      void fetchCollections().then(setCollections).catch(() => setCollections([]));
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const result = await fetchMemoryManagerSources();
      setSources(result.sources);
      setPxReason(result.perspicax.available ? undefined : result.perspicax.reason);
      setError(null);
      void loadOverviews(result.sources);
    } catch (cause) {
      setError(readableError(cause));
      setSources([]);
    }
  }, [loadOverviews]);

  useEffect(() => { void loadSources(); }, [loadSources]);

  const refresh = useCallback(() => {
    bodiesRequested.current.clear();
    if (sources) void loadOverviews(sources);
  }, [sources, loadOverviews]);

  // ---- tiers and rows ------------------------------------------------------------------

  const { pxSource, pxTiers, botSources, teamSources, meTier, tiers, tierByKey, pxTierKey, factsByBot, rows, rowByKey, archivedRows, pxTrashRows, trashRows, counts, placeRows } = useMemoryRows({ sources, overviews, journals, bodies, archivedRaw, trashRaw, pins, place, openCollection, collections, collectionItems, overviewsReady, setBodies, bodiesRequested, mounted, setCollectionItems, setOpenCollection });

  /** A row of the rail: its scope, on the tab in view (every tab is scoped). */
  const goPlace = (next: Place, toNotes = false) => {
    setPreview(null);
    setPlace(next);
    setScreen({ kind: "list" });
    if (toNotes) setView("notes");
    setNote(null);
    setListQuery(undefined);
  };

  // ---- notes ---------------------------------------------------------------------------

  const loadDetail = async (entry: PageRow): Promise<MemoryNoteDetail> => {
    let detail: MemoryNoteDetail | null = null;
    if (entry.source.kind === "bot" && entry.source.botId && entry.row.path) detail = await openBotNote(entry.source.botId, entry.row.path);
    else if (entry.source.kind === "team") detail = await openTeamNote(entry.source.section ?? "", entry.row.id);
    else if (entry.source.kind === "perspicax" && entry.row.scope) detail = await openPerspicaxNote(entry.row.scope, entry.row.id);
    if (!detail) throw new Error(t("memoryManager.noteMissing"));
    return entry.source.kind === "bot" ? { ...detail, title: entry.row.title } : detail;
  };

  /** A click: the note in the preview panel beside the list or the map. */
  const openPreview = async (entry: PageRow) => {
    setPreview({ entry, detail: null });
    try {
      const detail = await loadDetail(entry);
      setPreview((current) => (current?.entry.key === entry.key ? { entry, detail } : current));
      setBodies((current) => ({ ...current, [entry.key]: detail.body }));
    } catch (cause) {
      setError(readableError(cause));
      setPreview(null);
    }
  };
  const previewKey = (key: string) => {
    const entry = rowByKey.get(key);
    if (entry) void openPreview(entry);
  };
  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) setPreview(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);
  // Escape leaves a note's page for the list too, unless it is typed into a field.
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
  // Back on the list: the scroll it had before the note opened.
  const listShown = screen.kind === "list" && !preview;
  useLayoutEffect(() => {
    if (listShown && listScrollRef.current) listScrollRef.current.scrollTop = listScrollTop.current;
  }, [listShown]);

  /** A double click (or Edit): the note's own page. */
  const openNote = async (entry: PageRow, edit = false) => {
    setBusy(true);
    setError(null);
    setNote(null);
    setPreview(null);
    setNoteEntry(entry);
    setView("notes");
    setScreen({ kind: "note", key: entry.key, edit });
    try {
      const detail = await loadDetail(entry);
      setNote(detail);
      setBodies((current) => ({ ...current, [entry.key]: detail.body }));
    } catch (cause) {
      setError(readableError(cause));
      setScreen({ kind: "list" });
    } finally {
      setBusy(false);
    }
  };

  const openKey = (key: string, edit = false) => {
    const entry = rowByKey.get(key);
    if (entry) void openNote(entry, edit);
  };

  const togglePin = (key: string) => setPins((current) => {
    const next = current.includes(key) ? current.filter((entry) => entry !== key) : [key, ...current];
    writePins(next);
    return next;
  });

  const saveNote = async (next: NoteSave): Promise<boolean> => {
    const entry = noteEntry;
    if (!note || !entry) return false;
    setBusy(true);
    setError(null);
    try {
      const source = entry.source;
      if (source.kind === "bot" && source.botId && note.path) {
        let path = note.path;
        const base = path.split("/").pop()?.replace(/\.md$/i, "") || "";
        if (next.title !== note.title && path !== "MEMORY.md") {
          const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "memory/";
          const nextPath = `${folder}${slugify(next.title, base)}.md`;
          if (nextPath !== path) {
            await saveBotNote(source.botId, nextPath, next.body, undefined);
            await deleteBotNotes(source.botId, [path]);
            path = nextPath;
          }
        }
        const result = await saveBotNote(source.botId, path, next.body, path === note.path ? note.hash : undefined);
        if (!result.ok) {
          setError(t("memoryManager.conflict"));
          setNote({ ...note, body: result.current, hash: result.currentHash, bodyKind: detectBodyKind(result.current) });
          return false;
        }
        const row = { ...entry.row, id: path, path, title: path === "MEMORY.md" ? "MEMORY.md" : next.title };
        setNote({ ...note, id: path, path, title: row.title, body: result.doc.text, hash: result.doc.hash, bodyKind: detectBodyKind(result.doc.text) });
        const moved = { ...entry, key: rowKey(source, row), row };
        setNoteEntry(moved);
        setScreen({ kind: "note", key: moved.key });
      } else if (source.kind === "team") {
        await api(`/api/team-memory/${note.id}?section=${encodeURIComponent(source.section ?? "")}`, {
          method: "PATCH",
          body: JSON.stringify({ name: next.title, detail: next.body }),
        });
        setNote({ ...note, title: next.title, body: next.body, bodyKind: detectBodyKind(next.body) });
      } else if (source.kind === "perspicax" && note.scope) {
        const saved = await pxMemory<{ body: string; title?: string; tags?: string[]; version?: number }>("/entry", {
          method: "PUT",
          body: JSON.stringify({ scope: note.scope, id: note.id, title: next.title, body: next.body, tags: next.tags, base_version: note.version }),
        });
        setNote({
          ...note,
          title: saved.title ?? next.title,
          body: saved.body ?? next.body,
          tags: saved.tags ?? next.tags,
          version: saved.version ?? note.version,
          bodyKind: detectBodyKind(saved.body ?? next.body),
        });
      }
      setNotice({ text: t("memoryManager.saved") });
      refresh();
      return true;
    } catch (cause) {
      setError(readableError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const lookup = (key: string) => rowByKey.get(key) ?? (noteEntry?.key === key ? noteEntry : undefined) ?? archivedRows.find((entry) => entry.key === key) ?? trashRows.find((entry) => entry.key === key);

  /** Deletes the rows (any source, several at once), with one Undo for all. */
  const deleteKeys = async (keys: string[]) => {
    const entries = keys.map(lookup).filter((entry): entry is PageRow => Boolean(entry));
    if (!entries.length) return;
    const ok = await confirmAsync({
      title: t("memoryManager.delete"),
      body: t("memoryManager.deleteConfirm", { count: entries.length }),
      confirmLabel: t("memoryManager.delete"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const undos: Array<() => Promise<void>> = [];
    let done = 0;
    try {
      const byBot = new Map<string, PageRow[]>();
      const byTeam = new Map<string, PageRow[]>();
      const px: PageRow[] = [];
      for (const entry of entries) {
        if (entry.source.kind === "bot" && entry.source.botId) byBot.set(entry.source.botId, [...(byBot.get(entry.source.botId) ?? []), entry]);
        else if (entry.source.kind === "team") byTeam.set(entry.source.section ?? "", [...(byTeam.get(entry.source.section ?? "") ?? []), entry]);
        else if (entry.source.kind === "perspicax") px.push(entry);
      }
      for (const [botId, list] of byBot) {
        const paths = list.map((entry) => entry.row.path).filter((path): path is string => Boolean(path));
        const { undoIds } = await deleteBotNotes(botId, paths);
        done += paths.length;
        undos.push(() => undoBotDeletes(botId, undoIds));
      }
      for (const [section, list] of byTeam) {
        const removed: Array<{ kind: string; name: string; detail: string }> = [];
        for (const entry of list) {
          const detail = await openTeamNote(section, entry.row.id);
          await api(`/api/team-memory/${entry.row.id}?section=${encodeURIComponent(section)}`, { method: "DELETE" });
          if (detail) removed.push({ kind: entry.row.folder || "term", name: detail.title, detail: detail.body });
          done += 1;
        }
        undos.push(async () => {
          for (const entry of removed) {
            await api(`/api/team-memory?section=${encodeURIComponent(section)}`, { method: "POST", body: JSON.stringify(entry) });
          }
        });
      }
      if (px.length) {
        const report = await pxMemory<{ done: number; batch?: string }>("/bulk", {
          method: "POST",
          body: JSON.stringify({ action: "delete", items: px.map((entry) => ({ scope: entry.row.scope, id: entry.row.id })) }),
        });
        done += report.done;
        const batch = report.batch;
        if (batch) undos.push(async () => { await pxMemory("/trash/undo", { method: "POST", body: JSON.stringify({ batch }) }); });
      }
      setNotice({
        text: t("memoryManager.deleted", { count: done }),
        undo: undos.length ? async () => { for (const undo of undos) await undo(); refresh(); } : undefined,
      });
      if (screen.kind === "note") { setScreen({ kind: "list" }); setNote(null); }
      setPins((current) => {
        const next = current.filter((key) => !keys.includes(key));
        writePins(next);
        return next;
      });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const restoreKeys = async (keys: string[]) => {
    const entries = keys.map(lookup).filter((entry): entry is PageRow => Boolean(entry));
    const fromBots = entries.filter((entry) => entry.key.startsWith("trash|bot:") && entry.source.botId);
    const items = entries.filter((entry) => !fromBots.includes(entry)).map((entry) => ({ scope: entry.row.scope, id: entry.row.id }));
    if (!items.length && !fromBots.length) return;
    setBusy(true);
    try {
      if (items.length) await pxMemory("/bulk", { method: "POST", body: JSON.stringify({ action: "restore", items }) });
      for (const entry of fromBots) await restoreBotChange(entry.source.botId!, entry.row.id);
      setNotice({ text: t("memoryManager.restored", { count: items.length + fromBots.length }) });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const emptyTrash = async () => {
    const ok = await confirmAsync({ title: t("memoryManager.emptyTrash"), body: t("memoryManager.emptyTrashConfirm", { count: pxTrashRows.length }), confirmLabel: t("memoryManager.emptyTrash"), tone: "danger" });
    if (!ok) return;
    setBusy(true);
    try {
      await pxMemory("/trash/empty", { method: "POST", body: JSON.stringify({}) });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  // ---- create and move -----------------------------------------------------------------

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    if (pxSource && meTier?.mayWrite) out.push({ id: `px:${meTier.scope}`, label: t("memoryManager.tierMine"), source: pxSource, folders: meTier.folders.map((folder) => folder.name), freeFolder: true });
    for (const source of botSources) if (source.mayWrite) out.push({ id: source.id, label: `${t("memoryManager.tierMine")} / ${source.name}`, source, folders: [], freeFolder: false });
    for (const source of teamSources) if (source.mayWrite) out.push({ id: source.id, label: source.name, source, folders: TEAM_KINDS, freeFolder: false });
    if (pxSource) {
      for (const tier of pxTiers) {
        if (tier.kind === "me" || !tier.mayWrite) continue;
        out.push({ id: `px:${tier.scope}`, label: tier.kind === "org" ? t("memoryManager.tierOrg") : tier.name, source: tierSource(pxSource, tier), folders: tier.folders.map((folder) => folder.name), freeFolder: true });
      }
    }
    return out;
  }, [pxSource, meTier, botSources, teamSources, pxTiers]);

  /** Where "New note" lands from the place shown. */
  const defaultTarget = (): { target?: Target; folder?: string } => {
    if (place.kind === "folder") {
      const entry = rows.find((row) => row.folderKey === place.folder || row.folderKey.startsWith(`${place.folder}/`));
      if (place.folder.startsWith("px:")) {
        const [scope, folder] = place.folder.slice(3).split("/");
        return { target: targets.find((target) => target.id === `px:${scope}`), folder };
      }
      const source = entry?.source ?? sources?.find((candidate) => place.folder === candidate.id || place.folder.startsWith(`${candidate.id}/`));
      const target = targets.find((candidate) => candidate.id === source?.id);
      return { target, folder: source?.kind === "team" ? place.folder.slice(source.id.length + 1) : undefined };
    }
    if (place.kind === "tier") {
      if (place.tier === "mine") return { target: targets.find((target) => target.id.startsWith("px:") && target.source.id === pxSource?.id) ?? targets.find((target) => target.source.kind === "bot") };
      if (place.tier.startsWith("perspicax:")) return { target: targets.find((target) => target.id === `px:${place.tier.slice(10)}`) };
      return { target: targets.find((target) => target.id === place.tier) };
    }
    return { target: targets[0] };
  };

  const startCreate = (target?: Target, folder?: string, options: { newFolder?: boolean; title?: string; body?: string } = {}) => {
    const chosen = target ?? defaultTarget().target ?? targets[0];
    if (!chosen) return;
    setCreateTarget(chosen.id);
    setCreateFolder(options.newFolder ? "" : folder ?? (chosen.source.kind === "team" ? "term" : chosen.freeFolder ? "notes" : ""));
    setCreateTitle(options.title ?? "");
    setCreateBody(options.body ?? "");
    setNewFolder(Boolean(options.newFolder));
    setView("notes");
    setScreen({ kind: "create" });
  };

  const createNote = async () => {
    const target = targets.find((entry) => entry.id === createTarget);
    const title = createTitle.trim();
    if (!target || !title) return;
    setBusy(true);
    setError(null);
    try {
      const source = target.source;
      if (source.kind === "bot" && source.botId) {
        const path = `memory/${slugify(title, "note")}.md`;
        await saveBotNote(source.botId, path, createBody || `# ${title}\n\n`, undefined);
        goPlace({ kind: "folder", tier: "mine", folder: `${source.id}/topics` }, true);
      } else if (source.kind === "team") {
        const kind = createFolder || "term";
        await api(`/api/team-memory?section=${encodeURIComponent(source.section ?? "")}`, { method: "POST", body: JSON.stringify({ kind, name: title, detail: createBody }) });
        goPlace({ kind: "folder", tier: source.id, folder: `${source.id}/${kind}` }, true);
      } else if (source.kind === "perspicax") {
        const scope = target.id.slice(3);
        const topic = createFolder.trim() || "notes";
        await pxMemory("/entry", { method: "POST", body: JSON.stringify({ scope, topic, title, body: createBody }) });
        goPlace({ kind: "folder", tier: pxTierKey(scope), folder: `px:${scope}/${topic}` }, true);
      }
      setNotice({ text: t("memoryManager.createdNote", { title }) });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const startMove = (keys: string[]) => {
    const first = lookup(keys[0] ?? "");
    setMoveTopic(first?.row.folder || "notes");
    setMoveScope(first?.row.scope || "me");
    setScreen({ kind: "move", keys });
  };

  const runMove = async () => {
    if (screen.kind !== "move") return;
    const topic = moveTopic.trim();
    if (!topic) return;
    const items = screen.keys.map(lookup).filter((entry): entry is PageRow => Boolean(entry)).map((entry) => ({ scope: entry.row.scope || moveScope, id: entry.row.id }));
    setBusy(true);
    setError(null);
    try {
      await pxMemory("/bulk", { method: "POST", body: JSON.stringify({ action: "move", items, topic, to: moveScope }) });
      setNotice({ text: t("memoryManager.moved", { count: items.length }) });
      setScreen({ kind: "list" });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  // A Perspicax folder renamed: its notes move to the new folder name.
  const renamePxFolder = async (scope: string, from: string, to: string) => {
    const items = rows.filter((entry) => entry.source.kind === "perspicax" && entry.row.scope === scope && entry.row.folder === from).map((entry) => ({ scope, id: entry.row.id }));
    if (!items.length) return;
    setBusy(true);
    setError(null);
    try {
      await pxMemory("/bulk", { method: "POST", body: JSON.stringify({ action: "move", items, topic: to, to: scope }) });
      setNotice({ text: t("memoryManager.folderRenamed", { from, to }) });
      if (place.kind === "folder" && place.folder === `px:${scope}/${from}`) setPlace({ ...place, folder: `px:${scope}/${to}` });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  // A Perspicax folder deleted: its notes go to the trash, with Undo.
  const deletePxFolder = async (scope: string, folder: string) => {
    const items = rows.filter((entry) => entry.source.kind === "perspicax" && entry.row.scope === scope && entry.row.folder === folder).map((entry) => ({ scope, id: entry.row.id }));
    const ok = await confirmAsync({
      title: t("memoryManager.deleteFolder"),
      body: t("memoryManager.deleteFolderConfirm", { folder, count: items.length }),
      confirmLabel: t("memoryManager.delete"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const report = await pxMemory<{ done: number; batch?: string }>("/bulk", { method: "POST", body: JSON.stringify({ action: "delete", items }) });
      const batch = report.batch;
      setNotice({
        text: t("memoryManager.deleted", { count: report.done }),
        undo: batch ? async () => { await pxMemory("/trash/undo", { method: "POST", body: JSON.stringify({ batch }) }); refresh(); } : undefined,
      });
      if (place.kind === "folder" && place.folder === `px:${scope}/${folder}`) setPlace({ kind: "all" });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  // A bot memory folder no bot is linked to (a temporary agent's): its notes
  // to the Trash (the journal keeps each one), with Undo.
  const deleteBotFolder = async (source: MemoryManagerSource) => {
    const browse = overviews[source.id];
    if (!source.botId || !browse) return;
    const paths = browse.notes.map((row) => row.path).filter((path): path is string => Boolean(path) && path !== MEMORY_INDEX);
    const clearIndex = (browse.indexBytes ?? 0) > 0;
    const ok = await confirmAsync({
      title: t("memoryManager.deleteFolder"),
      body: t("memoryManager.deleteFolderTrash", { folder: source.name, count: paths.length + (clearIndex ? 1 : 0) }),
      confirmLabel: t("memoryManager.delete"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const botId = source.botId;
      const { undoIds, count } = await emptyBotFolder(botId, paths, clearIndex);
      setNotice({
        text: t("memoryManager.deleted", { count }),
        undo: undoIds.length ? async () => { await undoBotDeletes(botId, undoIds); refresh(); } : undefined,
      });
      if (place.kind === "folder" && (place.folder === source.id || place.folder.startsWith(`${source.id}/`))) setPlace({ kind: "all" });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  /** "Delete folder…" in a folder's ⋯ menu: offered when no bot is linked to it, greyed with the reason otherwise. */
  const folderMenu = (link: FolderLink, remove: (() => void) | null, blocked?: string): MemoryFolderMenu => ({
    lines: linkLines(link),
    items: [{
      id: "delete",
      label: t("memoryManager.deleteFolderItem"),
      danger: true,
      onSelect: () => remove?.(),
      disabledReason: isLinked(link) ? t("memoryManager.deleteFolderLinked", { bot: botNames(link) }) : remove ? undefined : blocked,
    }],
  });
  const linkTitle = (link: FolderLink) => (isLinked(link) ? t("memoryManager.linkedTo", { bot: botNames(link) }) : t("memoryManager.notLinkedLine"));

  // A Perspicax folder's manual order (the console's drag in Manual order).
  const reorder = async (ids: string[]) => {
    if (place.kind !== "folder" || !place.folder.startsWith("px:")) return;
    const cut = place.folder.indexOf("/");
    const scope = place.folder.slice(3, cut);
    const topic = place.folder.slice(cut + 1);
    setBusy(true);
    try {
      await pxMemory("/order", { method: "PUT", body: JSON.stringify({ scope, kind: "note", topic, ids }) });
      setNotice({ text: t("memoryManager.orderSaved") });
      refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const collect = async (keys: string[], collection: string) => {
    const notes = keys.map(lookup).filter((entry): entry is PageRow => Boolean(entry?.row.scope)).map((entry) => ({ scope: entry.row.scope!, id: entry.row.id }));
    try {
      await addToCollection(collection, notes);
      // its cached notes are stale: the next Collections scope reloads them
      setCollectionItems((current) => { const next = { ...current }; delete next[collection]; return next; });
      const title = collections.find((entry) => entry.id === collection)?.title ?? "";
      setNotice({ text: t("memoryManager.collections.added", { count: notes.length, title }) });
      void fetchCollections().then(setCollections).catch(() => undefined);
    } catch (cause) {
      setError(readableError(cause));
    }
  };

  // ---- keyboard: Cmd+O (Ctrl+O elsewhere) opens a note, as in the console --------------

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
  }, [mac]);
  useEffect(() => {
    if (switcherOpen) requestAnimationFrame(() => switcherRef.current?.focus());
    else setSwitcherQuery("");
  }, [switcherOpen]);

  // ---- the explorer --------------------------------------------------------------------

  // The folder stays selected while one of its notes is read.
  const current = (next: Place) => JSON.stringify(next) === JSON.stringify(place);
  const lists: MemorySidebarNav[] = [
    { id: "all", label: t("memoryManager.nav.all"), icon: NotebookText, count: counts.all, current: current({ kind: "all" }), onOpen: () => goPlace({ kind: "all" }) },
  ];
  if (counts.teams > 0 || tiers.some((tier) => tier.kind === "team")) lists.push({ id: "teams", label: t("memoryManager.nav.teams"), icon: Users, count: counts.teams, current: current({ kind: "teams" }), onOpen: () => goPlace({ kind: "teams" }) });
  lists.push(
    { id: "pinned", label: t("memoryManager.nav.pinned"), icon: Pin, count: counts.pinned, current: current({ kind: "pinned" }), onOpen: () => goPlace({ kind: "pinned" }) },
    { id: "recent", label: t("memoryManager.nav.recent"), icon: Clock3, count: counts.recent, current: current({ kind: "recent" }), onOpen: () => goPlace({ kind: "recent" }) },
    { id: "review", label: t("memoryManager.nav.review"), icon: CircleCheck, count: counts.review, dot: counts.review > 0, current: current({ kind: "review" }), onOpen: () => goPlace({ kind: "review" }) },
  );
  const tidy: MemorySidebarNav[] = [
    ...(pxSource ? [
      { id: "collections", label: t("memoryManager.collections.title"), icon: BookOpen, count: collections.length, current: current({ kind: "collections" }), onOpen: () => goPlace({ kind: "collections" }) },
      { id: "archived", label: t("memoryManager.nav.archived"), icon: Archive, count: archivedRows.length, current: current({ kind: "archived" }), onOpen: () => goPlace({ kind: "archived" }) },
    ] : []),
    ...(pxSource || trashRows.length ? [{ id: "trash", label: t("memoryManager.nav.trash"), icon: Trash2, count: trashRows.length, current: current({ kind: "trash" }), onOpen: () => goPlace({ kind: "trash" }) }] : []),
    ...(sources?.length ? [{ id: "import", label: t("memoryManager.import.open"), icon: FolderInput, count: null, current: false, onOpen: () => setImportOpen(true) }] : []),
  ];

  const folderCount = (key: string) => rows.filter((entry) => entry.folderKey === key || entry.folderKey.startsWith(`${key}/`)).length;
  const folderPlace = (tier: string, folder: string): Place => ({ kind: "folder", tier, folder });

  const pxFolders = (tier: MemoryTierRow, tierKey: string): MemorySidebarFolder[] => {
    if (!pxSource) return [];
    const target = targets.find((entry) => entry.id === `px:${tier.scope}`);
    return tier.folders.map((folder) => {
      const key = `px:${tier.scope}/${folder.name}`;
      const link = pxFolderLink(folder.name, linkBots, linkRoutines);
      const actions: MemoryRowAction[] = tier.mayWrite ? [
        { kind: "new", label: t("memoryManager.newIn", { folder: folder.name }), onClick: () => startCreate(target, folder.name) },
        { kind: "rename", label: t("memoryManager.renameFolder", { folder: folder.name }), onClick: () => setRenaming(key) },
      ] : [];
      return {
        key,
        name: folder.name,
        title: linkTitle(link),
        icon: "folder",
        leading: isLinked(link) ? <LinkMark bot={link.bots[0]!} /> : undefined,
        unlinked: !isLinked(link),
        menu: folderMenu(link, tier.mayWrite ? () => void deletePxFolder(tier.scope, folder.name) : null, t("memoryManager.deleteFolderReadOnly")),
        count: folder.count,
        current: current(folderPlace(tierKey, key)),
        onOpen: () => goPlace(folderPlace(tierKey, key)),
        actions,
        onRename: (next) => void renamePxFolder(tier.scope, folder.name, next),
        data: { "data-memory-folder": folder.id },
      };
    });
  };

  const explorerTiers: MemorySidebarTier[] = tiers.map((tier) => {
    const tierPlace: Place = { kind: "tier", tier: tier.key };
    const base = { key: tier.key, name: tier.name, color: tier.color, count: rows.filter((entry) => entry.tier === tier.key).length, current: current(tierPlace), onOpen: () => goPlace(tierPlace), data: { "data-memory-tier": tier.key } };
    if (tier.key === "mine") {
      const botFolders: MemorySidebarFolder[] = botSources.map((source) => {
        const link = botSourceLink(source, linkBots, linkRoutines);
        return {
        key: source.id,
        name: source.name,
        title: linkTitle(link),
        icon: isLinked(link) ? "bot" as const : "folder" as const,
        leading: isLinked(link) ? <LinkMark bot={link.bots[0]!} /> : undefined,
        unlinked: !isLinked(link),
        menu: folderMenu(link, source.mayWrite ? () => void deleteBotFolder(source) : null, t("memoryManager.deleteFolderReadOnly")),
        count: folderCount(source.id),
        current: current(folderPlace("mine", source.id)),
        onOpen: () => goPlace(folderPlace("mine", source.id)),
        actions: source.mayWrite ? [{ kind: "new", label: t("memoryManager.newIn", { folder: source.name }), onClick: () => startCreate(targets.find((target) => target.id === source.id)) }] : [],
        children: (overviews[source.id]?.folders ?? []).map((folder) => {
          const key = `${source.id}/${folder.id}`;
          return {
            key,
            name: folder.id === "logs" ? t("memoryManager.folderLogs") : t("memoryManager.folderTopics"),
            icon: "folder" as const,
            count: folder.count,
            current: current(folderPlace("mine", key)),
            onOpen: () => goPlace(folderPlace("mine", key)),
            actions: [],
            data: { "data-memory-folder": key },
          };
        }),
        data: { "data-memory-source": source.id },
        };
      });
      const meTarget = meTier ? targets.find((target) => target.id === `px:${meTier.scope}`) : undefined;
      return {
        ...base,
        title: t("memoryManager.tierMineHint"),
        actions: meTarget ? [
          { kind: "new", label: t("memoryManager.newNote"), onClick: () => startCreate(meTarget) },
          { kind: "newFolder", label: t("memoryManager.newFolder"), onClick: () => startCreate(meTarget, undefined, { newFolder: true }) },
        ] : [],
        folders: [...(meTier ? pxFolders(meTier, "mine") : []), ...botFolders],
      };
    }
    const team = teamSources.find((source) => source.id === tier.key);
    if (team) {
      const target = targets.find((entry) => entry.id === team.id);
      return {
        ...base,
        title: team.detail,
        actions: target ? [{ kind: "new", label: t("memoryManager.newIn", { folder: team.name }), onClick: () => startCreate(target) }] : [],
        folders: (overviews[team.id]?.folders ?? []).map((folder) => {
          const key = `${team.id}/${folder.id}`;
          const link = teamFolderLink(team.section ?? "", linkBots);
          return {
            key,
            name: folder.name,
            title: linkTitle(link),
            icon: "folder" as const,
            unlinked: true,
            menu: folderMenu(link, null, t("memoryManager.deleteFolderTeamKind")),
            count: folder.count,
            current: current(folderPlace(team.id, key)),
            onOpen: () => goPlace(folderPlace(team.id, key)),
            actions: target ? [{ kind: "new" as const, label: t("memoryManager.newIn", { folder: folder.name }), onClick: () => startCreate(target, folder.id) }] : [],
            data: { "data-memory-folder": key },
          };
        }),
        data: { ...base.data, "data-memory-source": team.id },
      };
    }
    const pxTier = pxTiers.find((entry) => `perspicax:${entry.scope}` === tier.key)!;
    const target = targets.find((entry) => entry.id === `px:${pxTier.scope}`);
    return {
      ...base,
      actions: target ? [
        { kind: "new", label: t("memoryManager.newIn", { folder: tier.name }), onClick: () => startCreate(target) },
        { kind: "newFolder", label: t("memoryManager.newFolder"), onClick: () => startCreate(target, undefined, { newFolder: true }) },
      ] : [],
      folders: pxFolders(pxTier, tier.key),
      data: { ...base.data, "data-memory-source": tier.key },
    };
  });

  const switcherHits = useMemo(() => {
    const words = switcherQuery.trim().toLowerCase();
    const list = words ? rows.filter((entry) => entry.row.title.toLowerCase().includes(words) || entry.folderPath.toLowerCase().includes(words)) : rows.filter((entry) => pins.includes(entry.key)).concat(rows).slice(0, 8);
    return [...new Map(list.map((entry) => [entry.key, entry])).values()].slice(0, 8);
  }, [switcherQuery, rows, pins]);

  const switcher = switcherOpen ? (
    <div className="absolute left-2 top-full z-40 mt-1.5 w-[360px] max-w-[calc(100vw-32px)] rounded-xl border-[0.5px] border-border bg-elevated p-1.5 popover-surface" data-memory-switcher="">
      <input
        ref={switcherRef}
        type="search"
        value={switcherQuery}
        onChange={(event) => setSwitcherQuery(event.target.value)}
        onBlur={() => setTimeout(() => setSwitcherOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setSwitcherOpen(false); }
          if (event.key === "Enter" && switcherHits[0]) { event.preventDefault(); setSwitcherOpen(false); void openNote(switcherHits[0]); }
        }}
        placeholder={t("memoryManager.switcherPlaceholder")}
        aria-label={t("memoryManager.openNote")}
        className={cn(FIELD, "mb-1")}
        data-memory-switcher-input=""
      />
      {switcherHits.map((entry) => (
        <button key={entry.key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSwitcherOpen(false); void openNote(entry); }} className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover" data-memory-switcher-hit="">
          <FileText size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{entry.row.title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-ink-tertiary"><Swatch color={tierByKey.get(entry.tier)?.color ?? ""} />{entry.folderPath}</span>
        </button>
      ))}
      {switcherHits.length === 0 && <p className="px-2 py-2 text-[12.5px] text-ink-secondary">{t("memoryManager.listNone")}</p>}
    </div>
  ) : null;

  const explorerLoading = sources === null || (sources.length > 0 && !overviewsReady) ? (
    <div className="flex min-h-[80px] items-center justify-center text-ink-secondary">
      <Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} />
    </div>
  ) : null;
  const explorerFooter = (
    <>
      {sources && sources.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-ink-secondary">{t("memoryManager.emptySources")}</p>}
      {pxReason === "link" && <p className="mt-3 px-2 text-[12px] text-ink-secondary">{t("memoryManager.pxLinkHint")}</p>}
      {pxReason === "sign_in" && <p className="mt-3 px-2 text-[12px] text-ink-secondary">{t("memoryManager.pxSignInHint")}</p>}
    </>
  );

  // ---- the list's title and line --------------------------------------------------------

  const placeText = (): [string, string] => {
    switch (place.kind) {
      case "all": return [t("memoryManager.nav.all"), t("memoryManager.nav.allHint")];
      case "teams": return [t("memoryManager.nav.teams"), t("memoryManager.nav.teamsHint")];
      case "pinned": return [t("memoryManager.nav.pinned"), t("memoryManager.nav.pinnedHint")];
      case "recent": return [t("memoryManager.nav.recent"), t("memoryManager.nav.recentHint")];
      case "review": return [t("memoryManager.nav.review"), t("memoryManager.nav.reviewHint")];
      case "archived": return [t("memoryManager.nav.archived"), t("memoryManager.nav.archivedHint")];
      case "trash": return [t("memoryManager.nav.trash"), t("memoryManager.trashHint")];
      case "collections": return [t("memoryManager.collections.title"), t("memoryManager.collections.hint")];
      case "tier": {
        const tier = tierByKey.get(place.tier);
        return [tier?.name ?? "", place.tier === "mine" ? t("memoryManager.tierMineHint") : t("memoryManager.tierHint", { tier: tier?.name ?? "" })];
      }
      case "folder": {
        const tier = tierByKey.get(place.tier);
        const entry = rows.find((row) => row.folderKey === place.folder || row.folderKey.startsWith(`${place.folder}/`));
        const name = place.folder.startsWith("px:") ? place.folder.slice(place.folder.indexOf("/") + 1)
          : botSources.find((source) => source.id === place.folder)?.name
            ?? (entry && place.folder !== entry.folderKey ? entry.source.name : entry?.folderPath)
            ?? place.folder.slice(place.folder.lastIndexOf("/") + 1);
        return [name, t("memoryManager.folderHint", { tier: tier?.name ?? "" })];
      }
    }
  };
  const [listTitle, listLine] = placeText();
  const templates: ListTemplate[] = rows.filter((entry) => entry.source.kind === "perspicax" && entry.row.folder === "templates").map((entry) => ({ key: entry.key, title: entry.row.title }));
  const fromTemplate = async (template: ListTemplate) => {
    const entry = rowByKey.get(template.key);
    if (!entry?.row.scope) return;
    try {
      const detail = await openPerspicaxNote(entry.row.scope, entry.row.id);
      const { target, folder } = defaultTarget();
      startCreate(target, folder, { title: detail.title, body: detail.body });
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  const canNewHere = place.kind === "all" || place.kind === "tier" || place.kind === "folder" ? Boolean(defaultTarget().target) : false;

  const noteTier = noteEntry ? tierByKey.get(noteEntry.tier) : undefined;
  const linksFor = useCallback((note: MemoryNoteDetail | null, noteEntry: PageRow | null): { out: PageLink[]; back: PageLink[] } => {
    if (!note || !noteEntry) return { out: [], back: [] };
    if (noteEntry.source.kind === "perspicax" && (note.linksOut || note.backlinks)) {
      const toKey = (link: { scope?: string; id: string }) => `perspicax|${link.scope}/${link.id}`;
      return {
        out: (note.linksOut ?? []).map((link) => ({ key: toKey(link), title: link.title })),
        back: (note.backlinks ?? []).map((link) => ({ key: toKey(link), title: link.title, context: link.context ?? undefined })),
      };
    }
    return { out: linksOut(note.body, rows, noteEntry.key), back: backlinksTo(note.title, rows, bodies, noteEntry.key) };
  }, [rows, bodies]);
  const noteLinks = useMemo(() => linksFor(note, noteEntry), [linksFor, note, noteEntry]);
  const previewLinks = useMemo(() => linksFor(preview?.detail ?? null, preview?.entry ?? null), [linksFor, preview]);

  // ---- tags and quality ------------------------------------------------------------------

  // ---- the scope: the rail's selection narrows Map, Tags and Quality as it does the list ----

  const scoped = place.kind !== "all";
  const scopeRows = placeRows;
  const scopeKeys = useMemo(() => new Set(scopeRows.map((entry) => entry.key)), [scopeRows]);
  const scopeTiers = useMemo(() => (scoped ? tiers.filter((tier) => scopeRows.some((entry) => entry.tier === tier.key)) : tiers), [scoped, tiers, scopeRows]);
  const stats = useMemo(() => tagStats(scopeRows, vocabulary), [scopeRows, vocabulary]);
  const allJournal = useMemo(() => Object.values(journals).flat(), [journals]);
  const scopeJournal = useMemo(() => (scoped ? allJournal.filter((row) => scopeKeys.has(`bot:${row.botId}|${row.path}`)) : allJournal), [scoped, allJournal, scopeKeys]);
  const scopeArchived = useMemo<number | null>(() => {
    if (!pxSource) return null;
    if (!scoped) return pxTiers.reduce((sum, tier) => sum + (tier.archived ?? 0), 0);
    if (place.kind === "archived") return archivedRows.length;
    if (place.kind === "tier") return archivedRows.filter((entry) => entry.tier === place.tier).length;
    if (place.kind === "folder") return archivedRows.filter((entry) => entry.folderKey === place.folder || entry.folderKey.startsWith(`${place.folder}/`)).length;
    return null;
  }, [pxSource, scoped, place, pxTiers, archivedRows]);
  const scopeReview = scoped ? scopeRows.filter((entry) => entry.row.status === "proposed").length : counts.review;
  const quality = useMemo(() => qualityStats(scopeRows, scopeArchived, scopeReview, Date.now(), stats), [scopeRows, scopeArchived, scopeReview, stats]);
  const active = useMemo(() => activeSeries(scopeRows, scopeTiers.map((tier) => tier.key), Date.now()), [scopeRows, scopeTiers]);
  const writes = useMemo(() => writeSeries(scopeJournal, Date.now()), [scopeJournal]);
  // "Wren / Logs": the folder under its bot or its tier, else the row's own name.
  const scopeLabel = (() => {
    if (place.kind === "collections" && openCollection) return `${listTitle} / ${openCollection.title}`;
    if (place.kind !== "folder") return listTitle;
    const bot = botSources.find((source) => source.id === place.folder);
    if (bot) return bot.name;
    const owner = botSources.find((source) => place.folder.startsWith(`${source.id}/`));
    if (owner) return `${owner.name} / ${listTitle}`;
    const tier = tierByKey.get(place.tier);
    return tier && tier.name !== listTitle ? `${tier.name} / ${listTitle}` : listTitle;
  })();

  // ---- import ----------------------------------------------------------------------------

  const importDestinations = useMemo<ImportDestination[]>(() => targets.filter((target) => target.source.kind !== "team").map((target) => {
    if (target.source.kind === "bot" && target.source.botId) {
      const sourceId = target.source.id;
      return {
        id: target.id,
        label: target.label,
        target: { kind: "bot" as const, botId: target.source.botId },
        folders: [],
        existing: rows.filter((entry) => entry.source.id === sourceId && entry.row.path?.startsWith("memory/")).map((entry) => ({ folder: "", title: entry.row.title, body: bodies[entry.key] })),
      };
    }
    const scope = target.id.slice(3);
    return {
      id: target.id,
      label: target.label,
      target: { kind: "perspicax" as const, scope },
      folders: target.folders,
      existing: rows.filter((entry) => entry.source.kind === "perspicax" && entry.row.scope === scope).map((entry) => ({ folder: entry.row.folder ?? "", title: entry.row.title, body: bodies[entry.key], id: entry.row.id })),
    };
  }), [targets, rows, bodies]);
  const importWriters = useMemo<ImportWriters>(() => ({
    bot: (botId, body) => api(`/api/bots/${botId}/memory/import`, { method: "POST", body: JSON.stringify(body) }),
    pxCreate: (note) => pxMemory("/entry", { method: "POST", body: JSON.stringify(note) }),
    pxUpdate: (note) => pxMemory("/entry", { method: "PUT", body: JSON.stringify(note) }),
  }), []);

  // ---- render ----------------------------------------------------------------------------

  const viewOptions = [
    { value: "notes" as const, label: t("memoryManager.viewNotes"), icon: FileText },
    { value: "map" as const, label: t("memoryManager.viewMap"), icon: Network },
    { value: "tags" as const, label: t("memoryManager.viewTags"), icon: Tag },
    { value: "quality" as const, label: t("memoryManager.viewQuality"), icon: Gauge },
  ];
  const loading = sources === null || (sources.length > 0 && !overviewsReady);
  const createTargetRow = targets.find((entry) => entry.id === createTarget);

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
            {view === "notes" && screen.kind !== "list" && !preview && (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" data-memory-reading="">

                {screen.kind === "note" && !note && busy && (
                  <div className="flex min-h-[160px] items-center justify-center text-ink-secondary"><Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} /></div>
                )}
                {screen.kind === "note" && note && noteEntry && (
                  <MemoryNoteView
                    key={`${noteEntry.key}:${screen.edit ? "edit" : "read"}`}
                    entry={noteEntry}
                    detail={note}
                    tier={noteTier}
                    facts={noteEntry.source.kind === "bot" && noteEntry.row.path ? factsByBot[noteEntry.source.botId ?? ""]?.get(noteEntry.row.path) : undefined}
                    linksOut={noteLinks.out}
                    backlinks={noteLinks.back}
                    pinned={pins.includes(noteEntry.key)}
                    startEditing={screen.edit}
                    busy={busy}
                    onBack={() => { setScreen({ kind: "list" }); setNote(null); }}
                    onPin={() => togglePin(noteEntry.key)}
                    onSave={saveNote}
                    onDelete={note.mayEdit ? () => void deleteKeys([noteEntry.key]) : undefined}
                    onMove={noteEntry.source.kind === "perspicax" && note.mayEdit ? () => startMove([noteEntry.key]) : undefined}
                    onNeighbourhood={() => { setMapFocus(noteEntry.key); setView("map"); }}
                    onOpenLink={(key) => openKey(key)}
                    linkColor={(key) => tierByKey.get(rowByKey.get(key)?.tier ?? "")?.color}
                  />
                )}

                {screen.kind === "create" && (
                  <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 rounded-xl border border-hairline/50 bg-panel p-5" data-memory-create-form="">
                    <h2 className="text-[20px] font-semibold text-ink">{newFolder ? t("memoryManager.newFolder") : t("memoryManager.newNote")}</h2>
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.where")}</span>
                      <select value={createTarget} onChange={(event) => { const next = targets.find((entry) => entry.id === event.target.value); setCreateTarget(event.target.value); setCreateFolder(next?.source.kind === "team" ? "term" : next?.freeFolder ? "notes" : ""); }} className={FIELD} data-memory-create-where="">
                        {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                      </select>
                    </label>
                    {createTargetRow && createTargetRow.source.kind === "team" && (
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                        <select value={createFolder} onChange={(event) => setCreateFolder(event.target.value)} className={FIELD}>
                          {TEAM_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                        </select>
                      </label>
                    )}
                    {createTargetRow?.freeFolder && (
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                        <input value={createFolder} onChange={(event) => setCreateFolder(event.target.value)} list="memory-create-folders" className={FIELD} data-memory-create-folder="" {...(newFolder ? { "data-initial-focus": "", autoFocus: true } : {})} />
                        <datalist id="memory-create-folders">{createTargetRow.folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.titleField")}</span>
                      <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createNote(); }} className={FIELD} data-memory-create-title="" {...(newFolder ? {} : { "data-initial-focus": "", autoFocus: true })} />
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] text-ink hover:bg-hover" onClick={() => setScreen({ kind: "list" })}>{t("common.cancel")}</button>
                      <button type="button" className={PRIMARY_BUTTON} disabled={busy || !createTitle.trim() || (newFolder && !createFolder.trim())} onClick={() => void createNote()} data-memory-create-submit="">
                        {t("memoryManager.create")}
                      </button>
                    </div>
                  </div>
                )}

                {screen.kind === "move" && (
                  <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 rounded-xl border border-hairline/50 bg-panel p-5" data-memory-move="">
                    <h2 className="text-[20px] font-semibold text-ink">{t("memoryManager.moveConfirm")}</h2>
                    <p className="text-[13px] text-ink-secondary">{t("memoryManager.moveHint", { count: screen.keys.length })}</p>
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.tier")}</span>
                      <select value={moveScope} onChange={(event) => setMoveScope(event.target.value)} className={FIELD} data-memory-move-tier="">
                        {pxTiers.filter((tier) => tier.mayWrite).map((tier) => (
                          <option key={tier.scope} value={tier.scope}>{tier.kind === "me" ? t("memoryManager.tierMine") : tier.kind === "org" ? t("memoryManager.tierOrg") : tier.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                      <input value={moveTopic} onChange={(event) => setMoveTopic(event.target.value)} list="memory-move-folders" className={FIELD} data-memory-move-folder="" />
                      <datalist id="memory-move-folders">{(pxTiers.find((tier) => tier.scope === moveScope)?.folders ?? []).map((folder) => <option key={folder.id} value={folder.name} />)}</datalist>
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] text-ink hover:bg-hover" onClick={() => setScreen({ kind: "list" })}>{t("common.cancel")}</button>
                      <button type="button" className={PRIMARY_BUTTON} disabled={busy || !moveTopic.trim()} onClick={() => void runMove()} data-memory-move-submit="">{t("memoryManager.moveConfirm")}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {importOpen && importDestinations.length > 0 && (
              <MemoryImportDialog
                destinations={importDestinations}
                defaultId={importDestinations.find((entry) => entry.target.kind === "perspicax" && entry.target.scope === meTier?.scope)?.id ?? importDestinations[0]!.id}
                writers={importWriters}
                onClose={() => setImportOpen(false)}
                onImported={(count) => { setNotice({ text: t("memoryManager.importedNotice", { count }) }); refresh(); }}
              />
            )}
            {/* A click on a row: the note in the content, in the list's place, left of the rail. */}
            {preview && (view === "notes" || view === "map") && (
              <div role="region" aria-label={preview.entry.row.title} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" data-memory-preview-panel="">
                {preview.detail ? (
                  <MemoryNoteView
                    key={`preview:${preview.entry.key}`}
                    variant="panel"
                    entry={preview.entry}
                    detail={preview.detail}
                    tier={tierByKey.get(preview.entry.tier)}
                    facts={preview.entry.source.kind === "bot" && preview.entry.row.path ? factsByBot[preview.entry.source.botId ?? ""]?.get(preview.entry.row.path) : undefined}
                    linksOut={previewLinks.out}
                    backlinks={previewLinks.back}
                    pinned={pins.includes(preview.entry.key)}
                    busy={busy}
                    onBack={() => setPreview(null)}
                    onPin={() => togglePin(preview.entry.key)}
                    onSave={async () => false}
                    onEditPage={() => void openNote(preview.entry, true)}
                    onDelete={preview.detail.mayEdit ? () => { const key = preview.entry.key; setPreview(null); void deleteKeys([key]); } : undefined}
                    onMove={preview.entry.source.kind === "perspicax" && preview.detail.mayEdit ? () => { const key = preview.entry.key; setPreview(null); startMove([key]); } : undefined}
                    onNeighbourhood={() => { setMapFocus(preview.entry.key); setPreview(null); setView("map"); }}
                    onOpenLink={previewKey}
                    linkColor={(key) => tierByKey.get(rowByKey.get(key)?.tier ?? "")?.color}
                  />
                ) : (
                  <div className="flex min-h-[160px] items-center justify-center text-ink-secondary"><Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} /></div>
                )}
              </div>
            )}
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
