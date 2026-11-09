import { useMemo, type Dispatch, type SetStateAction } from "react";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { api } from "@/state/store";
import {
  decidePerspicaxReview, deleteBotNotes, detectBodyKind, openBotNote, openPerspicaxNote, openPerspicaxReview, openTeamNote,
  pxMemory, restoreBotChange, saveBotNote, undoBotDeletes,
  type MemoryBrowse, type MemoryManagerSource, type MemoryNoteDetail, type MemoryTierRow,
} from "@/lib/memory-manager";
import { canDecideRow, rowKey, type PageRow } from "@/lib/memory-page";
import { confirmAsync } from "../ConfirmProvider";
import type { CollectionSummary } from "./MemoryCollections";
import type { NoteSave } from "./MemoryNoteView";
import type { Place } from "./memory-manager-types";
import { TEAM_KINDS, slugify, writePins } from "./memory-manager-helpers";
import { tierSource } from "./memory-manager-data";
import { memoryFolderActions } from "./memory-folder-actions";

type Screen =
  | { kind: "list" }
  | { kind: "note"; key: string; edit?: boolean }
  | { kind: "create" }
  | { kind: "move"; keys: string[] };

interface Notice {
  text: string;
  undo?: () => Promise<void>;
}

export interface Target {
  id: string;
  label: string;
  source: MemoryManagerSource;
  folders: string[];
  freeFolder: boolean;
}

export interface MemoryActionsInput {
  sources: MemoryManagerSource[] | null;
  overviews: Record<string, MemoryBrowse>;
  pxSource: MemoryManagerSource | null;
  pxTiers: MemoryTierRow[];
  botSources: MemoryManagerSource[];
  teamSources: MemoryManagerSource[];
  meTier: MemoryTierRow | undefined;
  rows: PageRow[];
  rowByKey: Map<string, PageRow>;
  /** Perspicax proposals waiting in a tier's queue (the Review list). */
  reviewRows: PageRow[];
  archivedRows: PageRow[];
  trashRows: PageRow[];
  pxTrashRows: PageRow[];
  place: Place;
  screen: Screen;
  note: MemoryNoteDetail | null;
  noteEntry: PageRow | null;
  createTarget: string;
  createFolder: string;
  createTitle: string;
  createBody: string;
  moveTopic: string;
  moveScope: string;
  collections: CollectionSummary[];
  pxTierKey: (scope: string | undefined) => string;
  refresh: () => void;
  setPlace: Dispatch<SetStateAction<Place>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setView: Dispatch<SetStateAction<"notes" | "map" | "tags" | "quality">>;
  setPreview: Dispatch<SetStateAction<{ entry: PageRow; detail: MemoryNoteDetail | null } | null>>;
  setNote: Dispatch<SetStateAction<MemoryNoteDetail | null>>;
  setNoteEntry: Dispatch<SetStateAction<PageRow | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  setPins: Dispatch<SetStateAction<string[]>>;
  setBodies: Dispatch<SetStateAction<Record<string, string>>>;
  setCreateTarget: Dispatch<SetStateAction<string>>;
  setCreateFolder: Dispatch<SetStateAction<string>>;
  setCreateTitle: Dispatch<SetStateAction<string>>;
  setCreateBody: Dispatch<SetStateAction<string>>;
  setNewFolder: Dispatch<SetStateAction<boolean>>;
  setMoveTopic: Dispatch<SetStateAction<string>>;
  setMoveScope: Dispatch<SetStateAction<string>>;
  setListQuery: Dispatch<SetStateAction<string | undefined>>;
  setCollectionItems: Dispatch<SetStateAction<Record<string, import("./MemoryCollections").CollectionItem[]>>>;
  setCollections: Dispatch<SetStateAction<CollectionSummary[]>>;
}

/** Note open/save/delete/create/move and folder mutations for the Memory page. */
export function useMemoryManagerActions(input: MemoryActionsInput) {
  const {
    sources, overviews, pxSource, pxTiers, botSources, teamSources, meTier, rows, rowByKey, reviewRows,
    archivedRows, trashRows, pxTrashRows, place, screen, note, noteEntry, createTarget, createFolder,
    createTitle, createBody, moveTopic, moveScope, collections, pxTierKey, refresh,
    setPlace, setScreen, setView, setPreview, setNote, setNoteEntry, setBusy, setError, setNotice,
    setPins, setBodies, setCreateTarget, setCreateFolder, setCreateTitle, setCreateBody, setNewFolder,
    setMoveTopic, setMoveScope, setListQuery, setCollectionItems, setCollections,
  } = input;

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
    if (entry.row.reviewId) detail = await openPerspicaxReview(entry.row.reviewId);
    else if (entry.source.kind === "bot" && entry.source.botId && entry.row.path) detail = await openBotNote(entry.source.botId, entry.row.path);
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
  const findRow = (key: string) => rowByKey.get(key) ?? reviewRows.find((entry) => entry.key === key);
  const previewKey = (key: string) => {
    const entry = findRow(key);
    if (entry) void openPreview(entry);
  };

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
    const entry = findRow(key);
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

  const lookup = (key: string) => findRow(key) ?? (noteEntry?.key === key ? noteEntry : undefined) ?? archivedRows.find((entry) => entry.key === key) ?? trashRows.find((entry) => entry.key === key);

  /** Deletes the rows (any source, several at once), with one Undo for all. */
  const deleteKeys = async (keys: string[]) => {
    // A pending Perspicax review is not a note yet: Deny settles it, never Delete.
    const entries = keys.map(lookup).filter((entry): entry is PageRow => Boolean(entry) && !entry!.row.reviewId);
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

  /**
   * #3106: approve or deny proposals from the Review list (one row, the
   * preview, or the selection). A team-memory proposal is accepted (PATCH
   * accept) or removed (DELETE settles its cards as deny); a Perspicax review
   * is approved or refused. Rows the viewer may not decide are skipped.
   */
  const decideKeys = async (keys: string[], decision: "approve" | "deny") => {
    const entries = keys.map(lookup).filter((entry): entry is PageRow => Boolean(entry) && canDecideRow(entry!));
    if (!entries.length) return;
    setBusy(true);
    setError(null);
    let done = 0;
    try {
      for (const entry of entries) {
        if (entry.row.reviewId) {
          await decidePerspicaxReview(entry.row.reviewId, decision);
        } else {
          const path = `/api/team-memory/${encodeURIComponent(entry.row.id)}?section=${encodeURIComponent(entry.source.section ?? "")}`;
          if (decision === "approve") await api(path, { method: "PATCH", body: JSON.stringify({ accept: true }) });
          else await api(path, { method: "DELETE" });
        }
        done += 1;
      }
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      const decided = new Set(entries.slice(0, done).map((entry) => entry.key));
      if (done) setNotice({ text: t(decision === "approve" ? "memoryManager.reviewApproved" : "memoryManager.reviewDenied", { count: done }) });
      setPreview((current) => (current && decided.has(current.entry.key) ? null : current));
      if (screen.kind === "note" && decided.has(screen.key)) { setScreen({ kind: "list" }); setNote(null); }
      setBusy(false);
      refresh();
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
  const { renamePxFolder, deletePxFolder, deleteBotFolder, folderMenu, linkTitle, reorder, collect } = memoryFolderActions({
    rows, place, overviews, collections, lookup, refresh,
    setBusy, setError, setNotice, setPlace, setCollectionItems, setCollections,
  });

  return {
    goPlace, loadDetail, openPreview, previewKey, openNote, openKey, togglePin, saveNote, lookup,
    deleteKeys, decideKeys, restoreKeys, emptyTrash, targets, defaultTarget, startCreate, createNote, startMove,
    runMove, renamePxFolder, deletePxFolder, deleteBotFolder, folderMenu, linkTitle, reorder, collect,
  };
}
