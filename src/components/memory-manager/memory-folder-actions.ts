import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  emptyBotFolder, undoBotDeletes, pxMemory,
  type MemoryManagerSource,
} from "@/lib/memory-manager";
import { MEMORY_INDEX } from "@/lib/memory";
import { botNames, isLinked, type FolderLink } from "@/lib/memory-folders";
import type { PageRow } from "@/lib/memory-page";
import { confirmAsync } from "../ConfirmProvider";
import { addToCollection, fetchCollections, type CollectionSummary, type CollectionItem } from "./MemoryCollections";
import type { MemoryFolderMenu } from "./MemorySidebar";
import type { Place } from "./memory-manager-types";
import { linkLines } from "./memory-manager-helpers";
import type { Dispatch, SetStateAction } from "react";

export interface MemoryFolderActionsInput {
  rows: PageRow[];
  place: Place;
  overviews: Record<string, import("@/lib/memory-manager").MemoryBrowse>;
  collections: CollectionSummary[];
  lookup: (key: string) => PageRow | undefined;
  refresh: () => void;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<{ text: string; undo?: () => Promise<void> } | null>>;
  setPlace: Dispatch<SetStateAction<Place>>;
  setCollectionItems: Dispatch<SetStateAction<Record<string, CollectionItem[]>>>;
  setCollections: Dispatch<SetStateAction<CollectionSummary[]>>;
}

/** Perspicax/bot folder mutations and collection adds for the Memory page. */
export function memoryFolderActions(input: MemoryFolderActionsInput) {
  const {
    rows, place, overviews, collections, lookup, refresh,
    setBusy, setError, setNotice, setPlace, setCollectionItems, setCollections,
  } = input;

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
  return { renamePxFolder, deletePxFolder, deleteBotFolder, folderMenu, linkTitle, reorder, collect };
}
