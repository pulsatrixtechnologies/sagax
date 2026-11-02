// Tools > Memory: main-column page (Automations / Team map family, 2026-11-02).
// Left list of sources and folders; notes list, note view, or map in the body.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  Check,
  FileText,
  Folder,
  List,
  Loader2,
  Network,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { buildMemoryMapGraph } from "@/lib/memory-map";
import { api, useStore } from "@/state/store";
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
} from "@/lib/memory-manager";
import { useCaptionChrome, useMacInsetChrome } from "../DesktopCapabilities";
import { PageSegment } from "../content-page";
import { confirmAsync } from "../ConfirmProvider";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { DANGER_PILL, PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { MemoryJsonTree } from "./MemoryJsonTree";
import { MemoryMapCanvas } from "./MemoryMapCanvas";

type Page =
  | { kind: "sources" }
  | { kind: "browse"; source: MemoryManagerSource; folder?: string }
  | { kind: "note"; source: MemoryManagerSource; noteId: string; scope?: string; path?: string }
  | { kind: "trash"; source: MemoryManagerSource }
  | { kind: "create"; source: MemoryManagerSource }
  | { kind: "move"; source: MemoryManagerSource; noteIds: string[] };

type ViewMode = "list" | "map";

interface Notice {
  text: string;
  undo?: () => Promise<void>;
}

function sourceIcon(kind: MemoryManagerSource["kind"]) {
  if (kind === "perspicax") return <Brain size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
  if (kind === "team") return <Folder size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
  return <FileText size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />;
}

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

/** Full-page Memory manager (main column). */
export function MemoryManagerPanel() {
  const { dispatch } = useStore();
  const { dragProps, controlsShiftStyle } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const close = useCallback(() => dispatch({ type: "toggleMemoryManager", open: false }), [dispatch]);
  const [page, setPage] = useState<Page>({ kind: "sources" });
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sources, setSources] = useState<MemoryManagerSource[] | null>(null);
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
  const [moveTopic, setMoveTopic] = useState("notes");
  const [moveScope, setMoveScope] = useState("me");
  const [trashRows, setTrashRows] = useState<Array<{ id: string; title: string; scope: string; may_manage?: boolean }>>([]);
  const [mapBodies, setMapBodies] = useState<Record<string, string>>({});

  const loadSources = useCallback(async () => {
    try {
      const result = await fetchMemoryManagerSources();
      setSources(result.sources);
      setPxReason(result.perspicax.available ? undefined : result.perspicax.reason);
      setError(null);
    } catch (cause) {
      setError(readableError(cause));
      setSources([]);
    }
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);

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
    setQuery("");
    setNote(null);
    setEditing(false);
    void loadBrowse(source, folder);
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
    const source = page.kind === "sources" ? null : "source" in page ? page.source : null;
    const row = browse?.notes.find((entry) => entry.id === noteId);
    if (!source || !row) return;
    void openNote(source, row);
  };

  const visibleNotes = useMemo(() => filterNotes(browse?.notes ?? [], query), [browse, query]);

  const mapGraph = useMemo(() => {
    if (page.kind === "sources" || !("source" in page) || !browse) return null;
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
          const slug = nextTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || base;
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
          undo: async () => { await undoBotDeletes(botId, undoIds); await loadBrowse(page.source); },
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
            ? async () => { await pxMemory("/trash/undo", { method: "POST", body: JSON.stringify({ batch }) }); await loadBrowse(page.source); }
            : undefined,
        });
      }
      setSelected(new Set());
      await loadBrowse(page.source, page.folder);
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

  const createNote = async () => {
    if (page.kind !== "create" || !createTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (page.source.kind === "bot" && page.source.botId) {
        const slug = createTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "note";
        const path = `memory/${slug}.md`;
        await saveBotNote(page.source.botId, path, `# ${createTitle.trim()}\n\n`, undefined);
        openBrowse(page.source);
      } else if (page.source.kind === "team") {
        await api(`/api/team-memory?section=${encodeURIComponent(page.source.section ?? "")}`, {
          method: "POST",
          body: JSON.stringify({ kind: "term", name: createTitle.trim(), detail: "" }),
        });
        openBrowse(page.source);
      } else if (page.source.kind === "perspicax") {
        await pxMemory("/entry", {
          method: "POST",
          body: JSON.stringify({ scope: "me", topic: "notes", title: createTitle.trim(), body: "" }),
        });
        openBrowse(page.source);
      }
      setCreateTitle("");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const activeSource = page.kind === "sources" ? null : "source" in page ? page.source : null;
  const showMap = viewMode === "map" && Boolean(activeSource && browse && mapGraph);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink" data-memory-manager-page="" data-memory-manager-panel="">
      {(macInset || browser) && <div className="content-topbar-strip" />}
      <header {...dragProps} className="content-topbar flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline/40 px-6 py-4 max-sm:pl-12">
        <div>
          <div className="flex items-center gap-2.5">
            <Brain size={18} className="text-ink-secondary" aria-hidden="true" />
            <h1 className="text-[17px] font-semibold leading-6 tracking-[-0.008em]">{t("memoryManager.title")}</h1>
          </div>
          <p className="mt-1 text-[12px] text-ink-secondary">{t("memoryManager.pageSubtitle")}</p>
        </div>
        <div style={controlsShiftStyle} className="flex flex-wrap items-center gap-2">
          <PageSegment
            label={t("memoryManager.viewLabel")}
            value={viewMode}
            onChange={(next) => setViewMode(next)}
            options={[
              { value: "list", label: t("memoryManager.viewList"), icon: List },
              { value: "map", label: t("memoryManager.viewMap"), icon: Network },
            ]}
          />
          {activeSource?.mayWrite && viewMode === "list" && (
            <button
              type="button"
              className={cn(PRIMARY_PILL, "h-9")}
              onClick={() => {
                if (!activeSource) return;
                setCreateTitle("");
                setPage({ kind: "create", source: activeSource });
                setViewMode("list");
              }}
            >
              <Plus size={14} aria-hidden="true" /> {t("memoryManager.new")}
            </button>
          )}
          <button type="button" aria-label={t("memoryManager.close")} className="flex size-9 items-center justify-center rounded-lg border border-hairline/50 bg-panel text-ink-secondary hover:bg-raised hover:text-ink" onClick={close}>
            <X size={16} />
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className="shrink-0 border-b border-hairline/40 px-6 py-2">
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

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-hairline/40 bg-panel/40" data-memory-sources="">
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {sources === null && (
              <div className="flex min-h-[120px] items-center justify-center text-ink-secondary">
                <Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} />
              </div>
            )}
            {sources?.map((source) => {
              const active = activeSource?.id === source.id;
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => openBrowse(source)}
                  className={cn(
                    "mb-0.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left",
                    active ? "bg-selected" : "hover:bg-raised",
                  )}
                  data-memory-source={source.id}
                >
                  {sourceIcon(source.kind)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{source.name}</span>
                    {source.detail && <span className="block truncate text-[11.5px] text-ink-secondary">{source.detail}</span>}
                  </span>
                </button>
              );
            })}
            {sources && sources.length === 0 && (
              <p className="px-2 py-6 text-center text-[12.5px] text-ink-secondary">{t("memoryManager.emptySources")}</p>
            )}
            {pxReason === "link" && (
              <p className="mt-2 px-2 text-[12px] text-ink-secondary">{t("memoryManager.pxLinkHint")}</p>
            )}
            {pxReason === "sign_in" && (
              <p className="mt-2 px-2 text-[12px] text-ink-secondary">{t("memoryManager.pxSignInHint")}</p>
            )}
            {activeSource && browse && browse.folders.length > 0 && (
              <div className="mt-3 border-t border-hairline/40 pt-3" data-memory-folders="">
                <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("memoryManager.folder")}</p>
                {browse.folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => openBrowse(activeSource, folder.name)}
                    className={cn(
                      "mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left",
                      page.kind === "browse" && page.folder === folder.name ? "bg-selected" : "hover:bg-raised",
                    )}
                  >
                    <Folder size={14} className="text-ink-secondary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{folder.name}</span>
                    <span className="text-[11px] tabular-nums text-ink-tertiary">{folder.count}</span>
                  </button>
                ))}
              </div>
            )}
            {activeSource?.kind === "perspicax" && (browse?.trashCount ?? 0) > 0 && (
              <button
                type="button"
                className="mt-3 w-full border-t border-hairline/40 px-2.5 py-2 text-left text-[12.5px] text-ink-secondary hover:bg-raised"
                onClick={() => void openTrash(activeSource)}
              >
                {t("memoryManager.openTrash", { count: browse?.trashCount ?? 0 })}
              </button>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {showMap && mapGraph ? (
            <MemoryMapCanvas
              graph={mapGraph}
              selectedNoteId={page.kind === "note" ? page.noteId : null}
              onOpenNote={openNoteById}
            />
          ) : (
            <>
              {activeSource && page.kind !== "create" && page.kind !== "move" && page.kind !== "trash" && (
                <div className="flex items-center gap-2 border-b border-hairline/40 px-4 py-2">
                  <Search size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("memoryManager.search")}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary"
                    data-memory-search=""
                  />
                </div>
              )}
              {selected.size > 0 && page.kind === "browse" && (
                <div className="flex items-center gap-2 border-b border-hairline/40 bg-raised/40 px-4 py-2" data-memory-bulk="">
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

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!activeSource && (
                  <p className="px-6 py-16 text-center text-[13px] text-ink-secondary">{t("memoryManager.pickSource")}</p>
                )}
                {busy && !browse && activeSource && page.kind === "browse" && (
                  <div className="flex min-h-[160px] items-center justify-center text-ink-secondary">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                )}
                {page.kind === "browse" && browse && (
                  <div className="px-3 py-2" data-memory-browse="">
                    {visibleNotes.map((row) => (
                      <div key={row.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-raised" data-memory-note-row={row.id}>
                        {browse.mayWrite && (
                          <input
                            type="checkbox"
                            checked={selected.has(row.id)}
                            onChange={() => toggleSelect(row.id)}
                            className="mt-1"
                            aria-label={t("memoryManager.selectNote", { title: row.title })}
                          />
                        )}
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openNote(page.source, row)}>
                          <span className="block truncate text-[13px] font-medium text-ink">{row.title}</span>
                          <span className="block truncate text-[12px] text-ink-secondary">
                            {[row.folder, row.excerpt].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      </div>
                    ))}
                    {visibleNotes.length === 0 && (
                      <p className="px-2 py-8 text-center text-[12.5px] text-ink-secondary">{t("memoryManager.emptyNotes")}</p>
                    )}
                  </div>
                )}

                {page.kind === "note" && note && (
                  <div className="flex min-h-0 flex-1 flex-col" data-memory-note="">
                    <div className="flex items-center gap-2 border-b border-hairline/40 px-4 py-2">
                      {editing ? (
                        <input
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          className="min-w-0 flex-1 rounded-md border border-border bg-ink/[0.03] px-2 py-1 text-[13px] font-medium text-ink outline-none focus:border-border-strong"
                          aria-label={t("memoryManager.titleField")}
                          data-memory-rename=""
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{note.title}</span>
                      )}
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
                    {(editing || note.tags.length > 0) && (
                      <div className="border-b border-hairline/30 px-4 py-2">
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
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                      {editing
                        ? <MarkdownEditor value={draft} onChange={setDraft} minHeight={280} showCount={false} dataField="memory-manager-note" ariaLabel={t("memoryManager.editorLabel")} />
                        : <ReadBody body={note.body} bodyKind={note.bodyKind} />}
                    </div>
                  </div>
                )}

                {page.kind === "create" && (
                  <div className="flex flex-col gap-3 px-6 py-6" data-memory-create="">
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.titleField")}</span>
                      <input
                        value={createTitle}
                        onChange={(event) => setCreateTitle(event.target.value)}
                        className="w-full max-w-md rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-border-strong"
                        data-initial-focus=""
                      />
                    </label>
                    <button type="button" className={cn(PRIMARY_PILL, "self-start")} disabled={busy || !createTitle.trim()} onClick={() => void createNote()}>
                      {t("memoryManager.create")}
                    </button>
                  </div>
                )}

                {page.kind === "move" && (
                  <div className="flex flex-col gap-3 px-6 py-6" data-memory-move="">
                    <p className="text-[12.5px] text-ink-secondary">{t("memoryManager.moveHint", { count: page.noteIds.length })}</p>
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
                  <div className="px-3 py-2" data-memory-trash="">
                    {trashRows.map((row) => (
                      <div key={`${row.scope}:${row.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.title}</span>
                        {row.may_manage !== false && (
                          <button
                            type="button"
                            className={PILL}
                            onClick={() => void pxMemory("/bulk", {
                              method: "POST",
                              body: JSON.stringify({ action: "restore", items: [{ scope: row.scope, id: row.id }] }),
                            }).then(() => openTrash(page.source))}
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
            </>
          )}
        </section>
      </div>
    </main>
  );
}
