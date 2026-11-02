// Tools > Memory: main-column page (Automations / Team map family, 2026-11-02).
// The header row and the body column are Automations' own pieces
// (content-page.tsx: PageHeader, PageHeading, PAGE_SCROLL, PAGE_COLUMN); the
// right column, where Automations puts its calendar rail (CalendarSidebar:
// 280px, border on its left), is the Perspicax console's notes explorer
// (MemorySidebar.tsx): search, the views with their counts, then the tiers
// and their folders.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Check,
  Clock3,
  Inbox,
  List,
  Loader2,
  Network,
  NotebookText,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { readableError } from "@/lib/plain-error";
import { buildMemoryMapGraph } from "@/lib/memory-map";
import { api, ApiError, useStore } from "@/state/store";
import {
  browseBotSource,
  browsePerspicax,
  browseTeamSource,
  deleteBotNotes,
  detectBodyKind,
  fetchMemoryManagerSources,
  filterNotes,
  openBotNote,
  openPerspicaxNote,
  openTeamNote,
  pxMemory,
  saveBotNote,
  splitJsonFences,
  undoBotDeletes,
  type MemoryBrowse,
  type MemoryManagerSource,
  type MemoryNoteDetail,
  type MemoryNoteRow,
  type MemoryTierRow,
} from "@/lib/memory-manager";
import { useCaptionChrome } from "../DesktopCapabilities";
import { PAGE_COLUMN, PAGE_HEADER_BUTTON, PAGE_SCROLL, PageHeader, PageHeading, PageSegment, PageTopStrip } from "../content-page";
import { confirmAsync } from "../ConfirmProvider";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { DANGER_PILL, PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { MemoryJsonTree } from "./MemoryJsonTree";
import { MemoryMapCanvas } from "./MemoryMapCanvas";
import { MemorySidebar, type MemoryRowAction, type MemorySidebarFolder, type MemorySidebarNav, type MemorySidebarTier } from "./MemorySidebar";

/** The views of the right column: every note, the team notes, the recent
 * ones, the proposals waiting for a review, and one tier's notes. */
type NavView = "all" | "teams" | "recent" | "review" | "mine";

type Page =
  | { kind: "nav"; nav: NavView }
  | { kind: "browse"; source: MemoryManagerSource; folder?: string }
  | { kind: "note"; source: MemoryManagerSource; noteId: string; scope?: string; path?: string }
  | { kind: "trash"; source: MemoryManagerSource }
  | { kind: "create"; source: MemoryManagerSource; folder?: string; newFolder?: boolean }
  | { kind: "move"; source: MemoryManagerSource; noteIds: string[] };

type ViewMode = "list" | "map";

interface Notice {
  text: string;
  undo?: () => Promise<void>;
}

/** A note of the aggregated views, with the source it opens in. */
interface SourcedRow {
  source: MemoryManagerSource;
  row: MemoryNoteRow;
}

const RECENT_MS = 7 * 86_400_000;
const ROW = "group flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-hover";

function ReadBody({ body, bodyKind }: { body: string; bodyKind: "markdown" | "json" }) {
  if (bodyKind === "json") return <MemoryJsonTree source={body} />;
  return (
    <div className="space-y-3" data-memory-read-body="">
      {splitJsonFences(body).map((part, index) => (
        part.kind === "json"
          ? <MemoryJsonTree key={index} source={part.value} />
          : <pre key={index} className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink">{part.value}</pre>
      ))}
    </div>
  );
}

function slugify(value: string, fallback: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}

/** A Perspicax tier opened on its own: the personal tier is the source itself. */
function tierSource(px: MemoryManagerSource, tier: MemoryTierRow): MemoryManagerSource {
  if (tier.kind === "me") return px;
  return { ...px, id: `perspicax:${tier.scope}`, name: tier.name, detail: undefined, scope: tier.scope, mayWrite: tier.mayWrite, mayManage: tier.mayManage };
}

/** Full-page Memory manager (main column). */
export function MemoryManagerPanel() {
  const { dispatch } = useStore();
  const { dragProps, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const close = useCallback(() => dispatch({ type: "toggleMemoryManager", open: false }), [dispatch]);
  const [page, setPage] = useState<Page>({ kind: "nav", nav: "all" });
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sources, setSources] = useState<MemoryManagerSource[] | null>(null);
  const [overviews, setOverviews] = useState<Record<string, MemoryBrowse>>({});
  const [overviewsReady, setOverviewsReady] = useState(false);
  const [pxReason, setPxReason] = useState<string | undefined>();
  const [browse, setBrowse] = useState<MemoryBrowse | null>(null);
  const [note, setNote] = useState<MemoryNoteDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createFolder, setCreateFolder] = useState("notes");
  const [moveTopic, setMoveTopic] = useState("notes");
  const [moveScope, setMoveScope] = useState("me");
  const [trashRows, setTrashRows] = useState<Array<{ id: string; title: string; scope: string; may_manage?: boolean }>>([]);
  const [mapBodies, setMapBodies] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mac = useMemo(() => isMacPlatform(), []);
  // The right column opens as Automations' calendar rail does: open from
  // 1280px, folded into its 40px strip below, a press away either way.
  const [explorerOpen, setExplorerOpen] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1280px)").matches);
  const focusSearch = useRef(false);

  // Every source's notes and folders, for the counts of the right column and
  // the aggregated views (no note bodies: those load when a note opens).
  const loadOverviews = useCallback(async (list: MemoryManagerSource[]) => {
    // A bot whose memory routes refuse this person (404 "no such bot", 403)
    // is not theirs to open: its row would only show that error, so it
    // leaves the column. The server already leaves such bots out.
    const refused = new Set<string>();
    const entries = await Promise.all(list.map(async (source) => {
      try {
        if (source.kind === "bot" && source.botId) return [source.id, await browseBotSource(source.botId)] as const;
        if (source.kind === "team") return [source.id, await browseTeamSource(source.section ?? "")] as const;
        if (source.kind === "perspicax") return [source.id, await browsePerspicax()] as const;
      } catch (cause) {
        /* one source that does not answer keeps the others */
        if (source.kind === "bot" && cause instanceof ApiError && (cause.status === 404 || cause.status === 403)) refused.add(source.id);
      }
      return null;
    }));
    const next: Record<string, MemoryBrowse> = {};
    for (const entry of entries) if (entry) next[entry[0]] = entry[1];
    if (refused.size) setSources((current) => current?.filter((source) => !refused.has(source.id)) ?? current);
    setOverviews(next);
    setOverviewsReady(true);
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

  useEffect(() => {
    if (!explorerOpen || !focusSearch.current) return;
    focusSearch.current = false;
    searchRef.current?.focus();
  }, [explorerOpen]);

  const refreshOverviews = useCallback(() => {
    if (sources) void loadOverviews(sources);
  }, [sources, loadOverviews]);

  // Cmd+O (Ctrl+O elsewhere): the search field, as in the Perspicax console.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.shiftKey || event.altKey || !(mac ? event.metaKey : event.ctrlKey) || event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      if (!searchRef.current) {
        // folded: open the column, then focus its field once it is drawn
        focusSearch.current = true;
        setExplorerOpen(true);
        return;
      }
      searchRef.current.focus();
      searchRef.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mac]);

  const loadBrowse = useCallback(async (source: MemoryManagerSource, folder?: string) => {
    setBusy(true);
    setError(null);
    setBrowse(null);
    setSelected(new Set());
    try {
      let next: MemoryBrowse;
      if (source.kind === "bot" && source.botId) next = await browseBotSource(source.botId);
      else if (source.kind === "team") next = await browseTeamSource(source.section ?? "");
      else if (source.kind === "perspicax") next = await browsePerspicax(folder, source.scope);
      else next = { folders: [], notes: [], mayWrite: false };
      setBrowse(next);
      // Prefetch note bodies for [[links]] on the map (dense fixtures included).
      const bodies: Record<string, string> = {};
      for (const row of next.notes.slice(0, 64)) {
        try {
          let detail: MemoryNoteDetail | null = null;
          if (source.kind === "bot" && source.botId && row.path) detail = await openBotNote(source.botId, row.path);
          else if (source.kind === "team") detail = await openTeamNote(source.section ?? "", row.id);
          else if (source.kind === "perspicax" && row.scope) detail = await openPerspicaxNote(row.scope, row.id);
          if (detail) bodies[row.id] = detail.body;
        } catch {
          /* skip one note */
        }
      }
      setMapBodies(bodies);
    } catch (cause) {
      setError(readableError(cause));
      setBrowse({ folders: [], notes: [], mayWrite: false });
      setMapBodies({});
    } finally {
      setBusy(false);
    }
  }, []);

  const openBrowse = (source: MemoryManagerSource, folder?: string) => {
    setPage({ kind: "browse", source, folder });
    setNote(null);
    setEditing(false);
    void loadBrowse(source, folder);
  };

  const openNav = (nav: NavView) => {
    setPage({ kind: "nav", nav });
    setNote(null);
    setEditing(false);
    setBrowse(null);
    setSelected(new Set());
  };

  const openNote = async (source: MemoryManagerSource, row: MemoryNoteRow) => {
    setBusy(true);
    setError(null);
    setNote(null);
    setEditing(false);
    setViewMode("list");
    try {
      let detail: MemoryNoteDetail | null = null;
      if (source.kind === "bot" && source.botId && row.path) detail = await openBotNote(source.botId, row.path);
      else if (source.kind === "team") detail = await openTeamNote(source.section ?? "", row.id);
      else if (source.kind === "perspicax" && row.scope) detail = await openPerspicaxNote(row.scope, row.id);
      if (!detail) throw new Error(t("memoryManager.noteMissing"));
      setNote(detail);
      setDraft(detail.body);
      setDraftTitle(detail.title);
      setDraftTags(detail.tags.join(", "));
      setPage({ kind: "note", source, noteId: row.id, scope: row.scope, path: row.path });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const openNoteById = (noteId: string) => {
    const source = "source" in page ? page.source : null;
    const row = browse?.notes.find((entry) => entry.id === noteId);
    if (!source || !row) return;
    void openNote(source, row);
  };

  // The Perspicax source and its tiers (personal, teams, organization).
  const pxSource = useMemo(() => sources?.find((source) => source.kind === "perspicax") ?? null, [sources]);
  const pxTiers = useMemo(() => (pxSource ? overviews[pxSource.id]?.tiers ?? [] : []), [pxSource, overviews]);
  const tierKind = useMemo(() => new Map(pxTiers.map((tier) => [tier.scope, tier.kind])), [pxTiers]);

  const allRows = useMemo<SourcedRow[]>(() => {
    const rows: SourcedRow[] = [];
    for (const source of sources ?? []) {
      const overview = overviews[source.id];
      if (!overview) continue;
      for (const row of overview.notes) {
        if (source.kind === "perspicax") {
          const tier = pxTiers.find((entry) => entry.scope === row.scope);
          rows.push({ source: tier && pxSource ? tierSource(pxSource, tier) : source, row });
        } else rows.push({ source, row });
      }
    }
    return rows;
  }, [sources, overviews, pxTiers, pxSource]);

  const isTeamRow = useCallback((entry: SourcedRow) => entry.source.kind === "team" || (entry.source.kind === "perspicax" && tierKind.get(entry.row.scope ?? "") === "team"), [tierKind]);
  const isMineRow = useCallback((entry: SourcedRow) => entry.source.kind === "bot" || (entry.source.kind === "perspicax" && tierKind.get(entry.row.scope ?? "") === "me"), [tierKind]);
  const navRows = useMemo(() => {
    const recentCutoff = Date.now() - RECENT_MS;
    return {
    all: allRows,
    teams: allRows.filter(isTeamRow),
    recent: allRows.filter((entry) => (entry.row.updatedAt ?? 0) >= recentCutoff).sort((a, b) => (b.row.updatedAt ?? 0) - (a.row.updatedAt ?? 0)),
    review: allRows.filter((entry) => entry.row.status === "proposed"),
    mine: allRows.filter(isMineRow),
    };
  }, [allRows, isTeamRow, isMineRow]);

  const pxTrashCount = pxSource ? overviews[pxSource.id]?.trashCount ?? 0 : 0;

  const browseNotes = useMemo(() => {
    const notes = browse?.notes ?? [];
    // Bot and team folders are a grouping of the one listing (Perspicax filters on the server).
    if (page.kind === "browse" && page.folder && page.source.kind !== "perspicax") return notes.filter((row) => row.folder === page.folder);
    return notes;
  }, [browse, page]);
  const visibleNotes = useMemo(() => filterNotes(browseNotes, query), [browseNotes, query]);
  const visibleNavRows = useMemo(() => {
    if (page.kind !== "nav") return [];
    const rows = navRows[page.nav];
    const keep = new Set(filterNotes(rows.map((entry) => entry.row), query));
    return rows.filter((entry) => keep.has(entry.row));
  }, [page, navRows, query]);

  const mapGraph = useMemo(() => {
    if (!("source" in page) || !browse) return null;
    return buildMemoryMapGraph({ source: page.source, browse, bodies: mapBodies });
  }, [page, browse, mapBodies]);

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const parseTags = (value: string) => value.split(",").map((tag) => tag.trim()).filter(Boolean);

  // Typing in "Open a note" from a note or a form goes back to a list to pick from.
  const onQuery = (next: string) => {
    setQuery(next);
    if (next.trim() && page.kind !== "browse" && page.kind !== "nav") openNav("all");
  };

  const saveNote = async () => {
    if (!note || page.kind !== "note") return;
    setBusy(true);
    setError(null);
    const nextTitle = draftTitle.trim() || note.title;
    const nextTags = parseTags(draftTags);
    try {
      if (page.source.kind === "bot" && page.source.botId && note.path) {
        let path = note.path;
        const base = path.split("/").pop()?.replace(/\.md$/i, "") || "";
        if (nextTitle !== note.title && path !== "MEMORY.md") {
          const slug = slugify(nextTitle, base);
          const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "memory/";
          const nextPath = `${folder}${slug}.md`;
          if (nextPath !== path) {
            await saveBotNote(page.source.botId, nextPath, draft, undefined);
            await deleteBotNotes(page.source.botId, [path]);
            path = nextPath;
          }
        }
        const result = await saveBotNote(page.source.botId, path, draft, path === note.path ? note.hash : undefined);
        if (!result.ok) {
          setError(t("memoryManager.conflict"));
          setNote({ ...note, body: result.current, hash: result.currentHash, bodyKind: detectBodyKind(result.current) });
          setDraft(result.current);
          return;
        }
        setNote({
          ...note,
          id: path,
          path,
          title: nextTitle,
          body: result.doc.text,
          hash: result.doc.hash,
          bodyKind: detectBodyKind(result.doc.text),
        });
        setDraft(result.doc.text);
        setPage({ kind: "note", source: page.source, noteId: path, path });
      } else if (page.source.kind === "team") {
        await api(`/api/team-memory/${note.id}?section=${encodeURIComponent(page.source.section ?? "")}`, {
          method: "PATCH",
          body: JSON.stringify({ name: nextTitle, detail: draft }),
        });
        setNote({ ...note, title: nextTitle, body: draft });
      } else if (page.source.kind === "perspicax" && note.scope) {
        const saved = await pxMemory<{ body: string; title?: string; tags?: string[]; version?: number }>("/entry", {
          method: "PUT",
          body: JSON.stringify({
            scope: note.scope,
            id: note.id,
            title: nextTitle,
            body: draft,
            tags: nextTags,
            base_version: note.version,
          }),
        });
        setNote({
          ...note,
          title: saved.title ?? nextTitle,
          body: saved.body ?? draft,
          tags: saved.tags ?? nextTags,
          version: saved.version ?? note.version,
          bodyKind: detectBodyKind(saved.body ?? draft),
        });
        setDraft(saved.body ?? draft);
        setDraftTitle(saved.title ?? nextTitle);
        setDraftTags((saved.tags ?? nextTags).join(", "));
      }
      setEditing(false);
      setNotice({ text: t("memoryManager.saved") });
      refreshOverviews();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const runMove = async () => {
    if (page.kind !== "move" || page.source.kind !== "perspicax") return;
    const topic = moveTopic.trim();
    if (!topic) return;
    setBusy(true);
    setError(null);
    try {
      const items = page.noteIds.map((id) => {
        const row = browse?.notes.find((noteRow) => noteRow.id === id);
        return { scope: row?.scope || moveScope, id };
      });
      await pxMemory("/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "move", items, topic, to: moveScope }),
      });
      setSelected(new Set());
      setNotice({ text: t("memoryManager.moved", { count: items.length }) });
      openBrowse(page.source);
      refreshOverviews();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (page.kind !== "browse" || !browse) return;
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirmAsync({
      title: t("memoryManager.delete"),
      body: t("memoryManager.deleteConfirm", { count: ids.length }),
      confirmLabel: t("memoryManager.delete"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      if (page.source.kind === "bot" && page.source.botId) {
        const paths = visibleNotes.filter((row) => ids.includes(row.id)).map((row) => row.path!).filter(Boolean);
        const { undoIds } = await deleteBotNotes(page.source.botId, paths);
        const botId = page.source.botId;
        setNotice({
          text: t("memoryManager.deleted", { count: paths.length }),
          undo: async () => { await undoBotDeletes(botId, undoIds); await loadBrowse(page.source); refreshOverviews(); },
        });
      } else if (page.source.kind === "team") {
        const removed: Array<{ id: string; kind: string; name: string; detail: string }> = [];
        for (const id of ids) {
          const row = browse.notes.find((noteRow) => noteRow.id === id);
          if (!row) continue;
          const detail = await openTeamNote(page.source.section ?? "", id);
          await api(`/api/team-memory/${id}?section=${encodeURIComponent(page.source.section ?? "")}`, { method: "DELETE" });
          if (detail) removed.push({ id, kind: row.folder || "term", name: detail.title, detail: detail.body });
        }
        const section = page.source.section ?? "";
        setNotice({
          text: t("memoryManager.deleted", { count: removed.length }),
          undo: async () => {
            for (const entry of removed) {
              await api(`/api/team-memory?section=${encodeURIComponent(section)}`, {
                method: "POST",
                body: JSON.stringify({ kind: entry.kind, name: entry.name, detail: entry.detail }),
              });
            }
            await loadBrowse(page.source);
            refreshOverviews();
          },
        });
      } else if (page.source.kind === "perspicax") {
        const items = visibleNotes.filter((row) => ids.includes(row.id)).map((row) => ({ scope: row.scope!, id: row.id }));
        const report = await pxMemory<{ done: number; batch?: string }>("/bulk", {
          method: "POST",
          body: JSON.stringify({ action: "delete", items }),
        });
        const batch = report.batch;
        setNotice({
          text: t("memoryManager.deleted", { count: report.done }),
          undo: batch
            ? async () => { await pxMemory("/trash/undo", { method: "POST", body: JSON.stringify({ batch }) }); await loadBrowse(page.source); refreshOverviews(); }
            : undefined,
        });
      }
      setSelected(new Set());
      await loadBrowse(page.source, page.folder);
      refreshOverviews();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const openTrash = async (source: MemoryManagerSource) => {
    setPage({ kind: "trash", source });
    setViewMode("list");
    setBusy(true);
    try {
      const list = await pxMemory<{ notes: Array<{ id: string; title: string; scope: string; may_manage?: boolean }> }>("/trash");
      setTrashRows(list.notes ?? []);
    } catch (cause) {
      setError(readableError(cause));
      setTrashRows([]);
    } finally {
      setBusy(false);
    }
  };

  const startCreate = (source: MemoryManagerSource, folder?: string, newFolder?: boolean) => {
    setCreateTitle("");
    setCreateFolder(newFolder ? "" : folder || "notes");
    setPage({ kind: "create", source, folder, newFolder });
    setViewMode("list");
  };

  const createNote = async () => {
    if (page.kind !== "create" || !createTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (page.source.kind === "bot" && page.source.botId) {
        const path = `memory/${slugify(createTitle, "note")}.md`;
        await saveBotNote(page.source.botId, path, `# ${createTitle.trim()}\n\n`, undefined);
        openBrowse(page.source);
      } else if (page.source.kind === "team") {
        await api(`/api/team-memory?section=${encodeURIComponent(page.source.section ?? "")}`, {
          method: "POST",
          body: JSON.stringify({ kind: page.folder || "term", name: createTitle.trim(), detail: "" }),
        });
        openBrowse(page.source, page.folder);
      } else if (page.source.kind === "perspicax") {
        const topic = createFolder.trim() || "notes";
        await pxMemory("/entry", {
          method: "POST",
          body: JSON.stringify({ scope: page.source.scope || "me", topic, title: createTitle.trim(), body: "" }),
        });
        openBrowse(page.source, page.folder || page.newFolder ? topic : undefined);
      }
      setCreateTitle("");
      refreshOverviews();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  // A Perspicax folder renamed: its notes move to the new folder name.
  const renamePxFolder = async (source: MemoryManagerSource, scope: string, from: string, to: string) => {
    const items = allRows.filter((entry) => entry.row.scope === scope && entry.row.folder === from).map((entry) => ({ scope, id: entry.row.id }));
    if (!items.length) return;
    setBusy(true);
    setError(null);
    try {
      await pxMemory("/bulk", { method: "POST", body: JSON.stringify({ action: "move", items, topic: to, to: scope }) });
      setNotice({ text: t("memoryManager.folderRenamed", { from, to }) });
      refreshOverviews();
      if ("source" in page && page.source.id === source.id) openBrowse(source, page.kind === "browse" && page.folder === from ? to : undefined);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  // A Perspicax folder deleted: its notes go to the trash, with Undo.
  const deletePxFolder = async (source: MemoryManagerSource, scope: string, folder: string) => {
    const items = allRows.filter((entry) => entry.row.scope === scope && entry.row.folder === folder).map((entry) => ({ scope, id: entry.row.id }));
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
        undo: batch ? async () => { await pxMemory("/trash/undo", { method: "POST", body: JSON.stringify({ batch }) }); refreshOverviews(); } : undefined,
      });
      refreshOverviews();
      if (page.kind === "browse" && page.source.id === source.id) openBrowse(source);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const activeSource = "source" in page ? page.source : null;
  const showMap = viewMode === "map" && Boolean(activeSource && browse && mapGraph);
  const browsing = (source: MemoryManagerSource, folder?: string) =>
    page.kind === "browse" && page.source.id === source.id && (page.folder ?? "") === (folder ?? "");

  // ---- the right column ---------------------------------------------------

  const nav: MemorySidebarNav[] = [
    { id: "all", label: t("memoryManager.nav.all"), icon: NotebookText, count: navRows.all.length, current: page.kind === "nav" && page.nav === "all", onOpen: () => openNav("all") },
  ];
  if (navRows.teams.length > 0 || (sources ?? []).some((source) => source.kind === "team")) {
    nav.push({ id: "teams", label: t("memoryManager.nav.teams"), icon: Users, count: navRows.teams.length, current: page.kind === "nav" && page.nav === "teams", onOpen: () => openNav("teams") });
  }
  if (navRows.recent.length > 0) {
    nav.push({ id: "recent", label: t("memoryManager.nav.recent"), icon: Clock3, count: navRows.recent.length, current: page.kind === "nav" && page.nav === "recent", onOpen: () => openNav("recent") });
  }
  if (navRows.review.length > 0) {
    nav.push({ id: "review", label: t("memoryManager.nav.review"), icon: Inbox, count: navRows.review.length, current: page.kind === "nav" && page.nav === "review", onOpen: () => openNav("review") });
  }
  if (pxSource) {
    nav.push({ id: "trash", label: t("memoryManager.nav.trash"), icon: Trash2, count: pxTrashCount, current: page.kind === "trash", onOpen: () => void openTrash(pxSource) });
  }

  const pxFolderRows = (tier: MemoryTierRow): MemorySidebarFolder[] => {
    if (!pxSource) return [];
    const source = tierSource(pxSource, tier);
    return tier.folders.map((folder) => {
      const actions: MemoryRowAction[] = tier.mayWrite ? [
        { kind: "new", label: t("memoryManager.newIn", { folder: folder.name }), onClick: () => startCreate(source, folder.name) },
        { kind: "rename", label: t("memoryManager.renameFolder", { folder: folder.name }), onClick: () => setRenaming(folder.id) },
        { kind: "delete", label: t("memoryManager.deleteFolderNamed", { folder: folder.name }), onClick: () => void deletePxFolder(source, tier.scope, folder.name) },
      ] : [];
      return {
        key: folder.id,
        name: folder.name,
        icon: "folder",
        count: folder.count,
        current: browsing(source, folder.name),
        onOpen: () => openBrowse(source, folder.name),
        actions,
        onRename: (next) => void renamePxFolder(source, tier.scope, folder.name, next),
        data: { "data-memory-folder": folder.id },
      };
    });
  };

  const sourceFolders = (source: MemoryManagerSource): MemorySidebarFolder[] => (overviews[source.id]?.folders ?? []).map((folder) => ({
    key: `${source.id}/${folder.id}`,
    name: source.kind === "bot" ? (folder.id === "logs" ? t("memoryManager.folderLogs") : t("memoryManager.folderTopics")) : folder.name,
    icon: "folder",
    count: folder.count,
    current: browsing(source, folder.id),
    onOpen: () => openBrowse(source, folder.id),
    actions: source.kind === "team" && source.mayWrite
      ? [{ kind: "new", label: t("memoryManager.newIn", { folder: folder.name }), onClick: () => startCreate(source, folder.id) }]
      : [],
    data: { "data-memory-folder": `${source.id}/${folder.id}` },
  }));

  const tiers: MemorySidebarTier[] = [];
  const botSources = (sources ?? []).filter((source) => source.kind === "bot");
  const meTier = pxTiers.find((tier) => tier.kind === "me");
  if (botSources.length > 0 || meTier) {
    const botRows: MemorySidebarFolder[] = botSources.map((source) => ({
      key: source.id,
      name: source.name,
      title: source.detail,
      icon: "bot",
      count: overviews[source.id]?.notes.length,
      current: browsing(source),
      onOpen: () => openBrowse(source),
      actions: source.mayWrite ? [{ kind: "new", label: t("memoryManager.newIn", { folder: source.name }), onClick: () => startCreate(source) }] : [],
      children: sourceFolders(source),
      data: { "data-memory-source": source.id },
    }));
    const meActions: MemoryRowAction[] = meTier?.mayWrite && pxSource ? [
      { kind: "new", label: t("memoryManager.newNote"), onClick: () => startCreate(pxSource) },
      { kind: "newFolder", label: t("memoryManager.newFolder"), onClick: () => startCreate(pxSource, undefined, true) },
    ] : [];
    tiers.push({
      key: "mine",
      name: t("memoryManager.tierMine"),
      title: t("memoryManager.tierMineHint"),
      dot: "success",
      count: navRows.mine.length,
      current: page.kind === "nav" && page.nav === "mine",
      onOpen: () => openNav("mine"),
      actions: meActions,
      folders: [...(meTier ? pxFolderRows(meTier) : []), ...botRows],
      data: { "data-memory-tier": "mine" },
    });
  }
  for (const source of (sources ?? []).filter((entry) => entry.kind === "team")) {
    tiers.push({
      key: source.id,
      name: source.name,
      title: source.detail,
      dot: "accent",
      count: overviews[source.id]?.notes.length ?? 0,
      current: browsing(source),
      onOpen: () => openBrowse(source),
      actions: source.mayWrite ? [{ kind: "new", label: t("memoryManager.newIn", { folder: source.name }), onClick: () => startCreate(source) }] : [],
      folders: sourceFolders(source),
      data: { "data-memory-source": source.id, "data-memory-tier": source.id },
    });
  }
  if (pxSource) {
    for (const tier of pxTiers.filter((entry) => entry.kind !== "me")) {
      const source = tierSource(pxSource, tier);
      tiers.push({
        key: source.id,
        name: tier.name,
        dot: tier.kind === "team" ? "accent" : "muted",
        count: tier.count,
        current: browsing(source),
        onOpen: () => openBrowse(source),
        actions: tier.mayWrite ? [
          { kind: "new", label: t("memoryManager.newIn", { folder: tier.name }), onClick: () => startCreate(source) },
          { kind: "newFolder", label: t("memoryManager.newFolder"), onClick: () => startCreate(source, undefined, true) },
        ] : [],
        folders: pxFolderRows(tier),
        data: { "data-memory-source": source.id, "data-memory-tier": source.id },
      });
    }
  }

  const sidebarLoading = sources === null ? (
    <div className="flex min-h-[80px] items-center justify-center text-ink-secondary">
      <Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} />
    </div>
  ) : null;
  const sidebarFooter = (
    <>
      {sources && sources.length === 0 && (
        <p className="px-3 py-6 text-center text-[12.5px] text-ink-secondary">{t("memoryManager.emptySources")}</p>
      )}
      {pxReason === "link" && <p className="mt-3 px-3 text-[12px] text-ink-secondary">{t("memoryManager.pxLinkHint")}</p>}
      {pxReason === "sign_in" && <p className="mt-3 px-3 text-[12px] text-ink-secondary">{t("memoryManager.pxSignInHint")}</p>}
    </>
  );

  // ---- the body column ------------------------------------------------------

  const navTitle: Record<NavView, string> = {
    all: t("memoryManager.nav.all"),
    teams: t("memoryManager.nav.teams"),
    recent: t("memoryManager.nav.recent"),
    review: t("memoryManager.nav.review"),
    mine: t("memoryManager.tierMine"),
  };
  const navSubtitle: Record<NavView, string> = {
    all: t("memoryManager.pageSubtitle"),
    teams: t("memoryManager.nav.teamsHint"),
    recent: t("memoryManager.nav.recentHint"),
    review: t("memoryManager.nav.reviewHint"),
    mine: t("memoryManager.tierMineHint"),
  };
  const folderLabel = (source: MemoryManagerSource, folder?: string) => {
    if (!folder) return undefined;
    if (source.kind === "bot") return folder === "logs" ? t("memoryManager.folderLogs") : t("memoryManager.folderTopics");
    return folder;
  };
  const section = page.kind === "nav"
    ? (page.nav === "all" ? null : navTitle[page.nav])
    : page.kind === "trash"
      ? t("memoryManager.nav.trash")
      : activeSource
        ? [activeSource.name, page.kind === "browse" ? folderLabel(activeSource, page.folder) : undefined].filter(Boolean).join(" / ")
        : null;

  const heading = (() => {
    if (page.kind === "nav") return { title: navTitle[page.nav], subtitle: navSubtitle[page.nav] };
    if (page.kind === "browse") {
      const folder = folderLabel(page.source, page.folder);
      return { title: folder ?? page.source.name, subtitle: folder ? page.source.name : page.source.detail ?? t("memoryManager.pageSubtitle") };
    }
    if (page.kind === "trash") return { title: t("memoryManager.nav.trash"), subtitle: t("memoryManager.trashHint") };
    if (page.kind === "create") return { title: page.newFolder ? t("memoryManager.newFolder") : t("memoryManager.newNote"), subtitle: [page.source.name, folderLabel(page.source, page.folder)].filter(Boolean).join(" / ") };
    if (page.kind === "move") return { title: t("memoryManager.moveConfirm"), subtitle: t("memoryManager.moveHint", { count: page.noteIds.length }) };
    return null;
  })();

  const noteRow = (key: string, source: MemoryManagerSource, row: MemoryNoteRow, options: { select?: boolean; showSource?: boolean }) => (
    <div key={key} className={ROW} data-memory-note-row={row.id}>
      {options.select && (
        <input
          type="checkbox"
          checked={selected.has(row.id)}
          onChange={() => toggleSelect(row.id)}
          className="mt-1"
          aria-label={t("memoryManager.selectNote", { title: row.title })}
        />
      )}
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openNote(source, row)}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{row.title}</span>
          {row.status === "proposed" && <span className="shrink-0 rounded-full bg-raised px-1.5 text-[11px] text-ink-secondary">{t("memoryManager.proposed")}</span>}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">
          {[options.showSource ? source.name : undefined, folderLabel(source, row.folder), row.excerpt].filter(Boolean).join(" · ")}
        </span>
      </button>
    </div>
  );

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink" data-memory-manager-page="" data-memory-manager-panel="">
      <PageTopStrip />
      <PageHeader
        name="memory"
        icon={Brain}
        title={t("memoryManager.title")}
        section={section}
        {...dragProps}
        topbar
        style={dragProps.style}
        primaryStyle={noDragStyle}
        actionsStyle={{ ...noDragStyle, ...controlsShiftStyle }}
        primary={
          <PageSegment
            label={t("memoryManager.viewLabel")}
            value={viewMode}
            onChange={(next) => setViewMode(next)}
            options={[
              { value: "list", label: t("memoryManager.viewList"), icon: List },
              { value: "map", label: t("memoryManager.viewMap"), icon: Network },
            ]}
          />
        }
        actions={<>
          {activeSource?.mayWrite && viewMode === "list" && (
            <button
              type="button"
              data-memory-create=""
              aria-label={t("memoryManager.newNote")}
              title={t("memoryManager.newNote")}
              className={cn(PAGE_HEADER_BUTTON, "h-9 w-auto gap-1.5 border-transparent bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent/90")}
              onClick={() => { if (activeSource) startCreate(activeSource, page.kind === "browse" ? page.folder : undefined); }}
            >
              <Plus size={15} aria-hidden="true" /><span className="@max-[30rem]/page-header:sr-only">{t("memoryManager.new")}</span>
            </button>
          )}
          <button type="button" aria-label={t("memoryManager.close")} title={t("memoryManager.close")} className={PAGE_HEADER_BUTTON} onClick={close}>
            <X size={16} />
          </button>
        </>}
        below={(error || notice) && (
          <div className="mt-2 space-y-2" style={noDragStyle}>
            {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
            {notice && (
              <div className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2 text-[12.5px] text-ink" data-memory-notice="">
                <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
                <span className="min-w-0 flex-1">{notice.text}</span>
                {notice.undo && (
                  <button type="button" className="text-accent hover:underline" onClick={() => void notice.undo?.().then(() => setNotice(null))}>
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
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {showMap && mapGraph ? (
              <MemoryMapCanvas
                graph={mapGraph}
                selectedNoteId={page.kind === "note" ? page.noteId : null}
                onOpenNote={openNoteById}
              />
            ) : (
              <div className={PAGE_SCROLL}>
                <div className={PAGE_COLUMN}>
                  {heading && <PageHeading title={heading.title} subtitle={heading.subtitle} />}

                  {viewMode === "map" && !activeSource && (
                    <p className="py-10 text-center text-[13px] text-ink-secondary">{t("memoryManager.pickSource")}</p>
                  )}

                  {page.kind === "nav" && viewMode === "list" && (
                    <div className="-mx-2" data-memory-nav-view={page.nav}>
                      {sources === null || (sources.length > 0 && !overviewsReady) ? (
                        <div className="flex min-h-[160px] items-center justify-center text-ink-secondary">
                          <Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} />
                        </div>
                      ) : (
                        <>
                          {visibleNavRows.map((entry) => noteRow(`${entry.source.id}:${entry.row.id}`, entry.source, entry.row, { showSource: true }))}
                          {visibleNavRows.length === 0 && (
                            <p className="px-2 py-8 text-center text-[12.5px] text-ink-secondary">{query.trim() ? t("memoryManager.noMatch", { query: query.trim() }) : t("memoryManager.emptyView")}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {selected.size > 0 && page.kind === "browse" && (
                    <div className="flex items-center gap-2 rounded-xl bg-raised/40 px-3 py-2" data-memory-bulk="">
                      <span className="text-[12px] text-ink-secondary">{t("memoryManager.selected", { count: selected.size })}</span>
                      {page.source.kind === "perspicax" && (
                        <button
                          type="button"
                          className={PILL}
                          onClick={() => {
                            setMoveTopic(page.folder || "notes");
                            setMoveScope(page.source.scope || "me");
                            setPage({ kind: "move", source: page.source, noteIds: [...selected] });
                          }}
                        >
                          {t("memoryManager.move")}
                        </button>
                      )}
                      <button type="button" className={cn(DANGER_PILL, "ml-auto")} onClick={() => void deleteSelected()} disabled={busy}>
                        <Trash2 size={13} aria-hidden="true" /> {t("memoryManager.delete")}
                      </button>
                    </div>
                  )}

                  {busy && !browse && page.kind === "browse" && (
                    <div className="flex min-h-[160px] items-center justify-center text-ink-secondary">
                      <Loader2 size={18} className="animate-spin" />
                    </div>
                  )}
                  {page.kind === "browse" && browse && (
                    <div className="-mx-2" data-memory-browse="">
                      {visibleNotes.map((row) => noteRow(row.id, page.source, row, { select: browse.mayWrite }))}
                      {visibleNotes.length === 0 && (
                        <p className="px-2 py-8 text-center text-[12.5px] text-ink-secondary">{query.trim() ? t("memoryManager.noMatch", { query: query.trim() }) : t("memoryManager.emptyNotes")}</p>
                      )}
                    </div>
                  )}

                  {page.kind === "note" && busy && !note && (
                    <div className="flex min-h-[160px] items-center justify-center text-ink-secondary">
                      <Loader2 size={18} className="animate-spin" />
                    </div>
                  )}
                  {page.kind === "note" && note && (
                    <div className="space-y-4" data-memory-note="">
                      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1">
                          {editing ? (
                            <input
                              value={draftTitle}
                              onChange={(event) => setDraftTitle(event.target.value)}
                              className="w-full rounded-md border border-border bg-ink/[0.03] px-2 py-1 text-[16px] font-semibold text-ink outline-none focus:border-border-strong"
                              aria-label={t("memoryManager.titleField")}
                              data-memory-rename=""
                            />
                          ) : (
                            <h2 className="truncate text-[16px] font-semibold text-ink">{note.title}</h2>
                          )}
                          <p className="mt-1 truncate text-[12px] text-ink-secondary">{[page.source.name, folderLabel(page.source, note.folder)].filter(Boolean).join(" · ")}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {note.mayEdit && !editing && (
                            <>
                              {page.source.kind === "perspicax" && (
                                <button
                                  type="button"
                                  className={PILL}
                                  onClick={() => {
                                    setMoveTopic(note.folder || "notes");
                                    setMoveScope(note.scope || "me");
                                    setPage({ kind: "move", source: page.source, noteIds: [note.id] });
                                  }}
                                >
                                  {t("memoryManager.move")}
                                </button>
                              )}
                              <button type="button" className={PILL} onClick={() => { setDraftTitle(note.title); setDraftTags(note.tags.join(", ")); setEditing(true); }}>{t("memoryManager.edit")}</button>
                            </>
                          )}
                          {editing && (
                            <>
                              <button type="button" className={PILL} onClick={() => { setEditing(false); setDraft(note.body); setDraftTitle(note.title); setDraftTags(note.tags.join(", ")); }}>{t("common.cancel")}</button>
                              <button type="button" className={PRIMARY_PILL} disabled={busy} onClick={() => void saveNote()}>{t("common.save")}</button>
                            </>
                          )}
                        </div>
                      </div>
                      {(editing || note.tags.length > 0) && (
                        <div>
                          {editing && page.source.kind === "perspicax" ? (
                            <label className="block">
                              <span className="mb-1 block text-[11px] font-medium text-ink-secondary">{t("memoryManager.tags")}</span>
                              <input
                                value={draftTags}
                                onChange={(event) => setDraftTags(event.target.value)}
                                placeholder={t("memoryManager.tagsHint")}
                                className="w-full rounded-md border border-border bg-ink/[0.03] px-2 py-1 text-[12.5px] text-ink outline-none focus:border-border-strong"
                                data-memory-tags=""
                              />
                            </label>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {note.tags.map((tag) => (
                                <span key={tag} className="rounded-md bg-raised px-1.5 py-0.5 text-[11px] text-ink-secondary">{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div>
                        {editing
                          ? <MarkdownEditor value={draft} onChange={setDraft} minHeight={280} showCount={false} dataField="memory-manager-note" ariaLabel={t("memoryManager.editorLabel")} />
                          : <ReadBody body={note.body} bodyKind={note.bodyKind} />}
                      </div>
                    </div>
                  )}

                  {page.kind === "create" && (
                    <div className="flex flex-col gap-3" data-memory-create-form="">
                      {page.source.kind === "perspicax" && (
                        <label className="block">
                          <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                          <input
                            value={createFolder}
                            onChange={(event) => setCreateFolder(event.target.value)}
                            className="w-full max-w-md rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-border-strong"
                            data-memory-create-folder=""
                            {...(page.newFolder ? { "data-initial-focus": "" } : {})}
                          />
                        </label>
                      )}
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.titleField")}</span>
                        <input
                          value={createTitle}
                          onChange={(event) => setCreateTitle(event.target.value)}
                          className="w-full max-w-md rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-border-strong"
                          {...(page.newFolder ? {} : { "data-initial-focus": "" })}
                        />
                      </label>
                      <button type="button" className={cn(PRIMARY_PILL, "self-start")} disabled={busy || !createTitle.trim() || (page.newFolder && !createFolder.trim())} onClick={() => void createNote()}>
                        {t("memoryManager.create")}
                      </button>
                    </div>
                  )}

                  {page.kind === "move" && (
                    <div className="flex flex-col gap-3" data-memory-move="">
                      <label className="block max-w-md">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                        <input
                          value={moveTopic}
                          onChange={(event) => setMoveTopic(event.target.value)}
                          className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-border-strong"
                          data-memory-move-folder=""
                        />
                      </label>
                      <label className="block max-w-md">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.tier")}</span>
                        <select
                          value={moveScope}
                          onChange={(event) => setMoveScope(event.target.value)}
                          className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-border-strong"
                          data-memory-move-tier=""
                        >
                          <option value="me">{t("memoryManager.tierMe")}</option>
                          <option value="org">{t("memoryManager.tierOrg")}</option>
                        </select>
                      </label>
                      <button type="button" className={cn(PRIMARY_PILL, "self-start")} disabled={busy || !moveTopic.trim()} onClick={() => void runMove()}>
                        {t("memoryManager.moveConfirm")}
                      </button>
                    </div>
                  )}

                  {page.kind === "trash" && (
                    <div className="-mx-2" data-memory-trash="">
                      {trashRows.map((row) => (
                        <div key={`${row.scope}:${row.id}`} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-hover">
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.title}</span>
                          {row.may_manage !== false && (
                            <button
                              type="button"
                              className={PILL}
                              onClick={() => void pxMemory("/bulk", {
                                method: "POST",
                                body: JSON.stringify({ action: "restore", items: [{ scope: row.scope, id: row.id }] }),
                              }).then(() => { refreshOverviews(); return openTrash(page.source); })}
                            >
                              {t("memoryManager.restore")}
                            </button>
                          )}
                        </div>
                      ))}
                      {trashRows.length === 0 && (
                        <p className="px-2 py-8 text-center text-[12.5px] text-ink-secondary">{t("memoryManager.trashEmpty")}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Automations' calendar rail: on the right of the body, 280px, after the content. */}
          {explorerOpen ? <MemorySidebar
            query={query}
            onQuery={onQuery}
            searchRef={searchRef}
            shortcut={mac ? "⌘O" : "Ctrl+O"}
            nav={nav}
            tiers={tiers}
            renaming={renaming}
            onRenameDone={() => setRenaming(null)}
            loading={sidebarLoading}
            footer={sidebarFooter}
            onCollapse={() => setExplorerOpen(false)}
          /> : (
            <button type="button" onClick={() => setExplorerOpen(true)} aria-label={t("memoryManager.explorerShow")} title={t("memoryManager.explorerShow")} className="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-hairline/40 bg-panel px-1 py-4 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink" data-memory-explorer-show="">
              <Brain size={16} aria-hidden="true" />
              <span className="[writing-mode:vertical-rl]">{t("memoryManager.sidebarLabel")}</span>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
