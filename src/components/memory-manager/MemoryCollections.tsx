// Tools > Memory > Tidy up > Collections, the Perspicax console's
// (notes-collections.tsx, 2026-11-02): curated, ordered lists of notes
// across folders, like books. The list of collections, a new one (title and
// description), and one collection: its notes in order, moved up or down,
// removed, saved; the collection deleted. Through /api/me/memory/collections
// (Perspicax `/memory/read/collections`), as the signed-in person.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Plus, Trash2, X } from "lucide-react";

import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { pxMemory } from "@/lib/memory-manager";
import { confirmAsync } from "../ConfirmProvider";
import { AuthorBadge, FIELD, GHOST_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON, relLabel } from "./memory-ui";

export interface CollectionSummary {
  id: string;
  scope: string;
  title: string;
  description: string;
  author_name?: string | null;
  updated_at?: string;
  item_count: number;
  may_edit: boolean;
}

export interface CollectionItem {
  note_scope: string;
  note_id: string;
  rank: number;
  title?: string | null;
  topic?: string | null;
  readable: boolean;
}

interface CollectionDetail extends CollectionSummary {
  items: CollectionItem[];
}

export function fetchCollections(): Promise<CollectionSummary[]> {
  return pxMemory<{ collections?: CollectionSummary[] }>("/collections").then((result) => result.collections ?? []);
}

/** One collection's notes, in order (the Collections scope of Map, Tags and Quality). */
export function fetchCollectionItems(id: string): Promise<CollectionItem[]> {
  return pxMemory<CollectionDetail>(`/collections/${encodeURIComponent(id)}`).then((detail) => [...(detail.items ?? [])].sort((a, b) => a.rank - b.rank));
}

/** Adds notes at the end of a collection (the server replaces the whole ordered list). */
export async function addToCollection(id: string, notes: Array<{ scope: string; id: string }>): Promise<void> {
  const detail = await pxMemory<CollectionDetail>(`/collections/${encodeURIComponent(id)}`);
  const items = detail.items.map((item) => ({ scope: item.note_scope, id: item.note_id }));
  for (const note of notes) if (!items.some((item) => item.scope === note.scope && item.id === note.id)) items.push(note);
  await pxMemory(`/collections/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ items }) });
}

export function MemoryCollections({ onOpenNote, onChanged, onSelect, openId }: {
  /** A collection's note pressed: the note, by its tier and id. */
  onOpenNote: (scope: string, id: string) => void;
  onChanged?: () => void;
  /** The collection opened (its fresh items), or none: the page narrows its scope to it. */
  onSelect?: (collection: { id: string; title: string; items: CollectionItem[] } | null) => void;
  /** The collection the page had open (back from another tab): it opens again. */
  openId?: string;
}) {
  const [list, setList] = useState<CollectionSummary[] | null>(null);
  const [open, setOpen] = useState<CollectionDetail | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await fetchCollections());
      setError(null);
    } catch (cause) {
      setError(readableError(cause));
      setList([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openOne = async (id: string) => {
    setBusy(true);
    try {
      const detail = await pxMemory<CollectionDetail>(`/collections/${encodeURIComponent(id)}`);
      const sorted = [...detail.items].sort((a, b) => a.rank - b.rank);
      setOpen(detail);
      setItems(sorted);
      onSelect?.({ id: detail.id, title: detail.title, items: sorted });
      setError(null);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  // Mount only: a collection opened before the tab changed opens again.
  const reopen = useRef(openId);
  useEffect(() => {
    if (reopen.current) void openOne(reopen.current);
  }, []);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const made = await pxMemory<CollectionDetail>("/collections", { method: "POST", body: JSON.stringify({ scope: "me", title: title.trim(), description: description.trim(), items: [] }) });
      setCreating(false);
      setTitle("");
      setDescription("");
      await load();
      onChanged?.();
      if (made?.id) await openOne(made.id);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!open) return;
    setBusy(true);
    try {
      await pxMemory(`/collections/${encodeURIComponent(open.id)}`, { method: "PUT", body: JSON.stringify({ items: items.map((item) => ({ scope: item.note_scope, id: item.note_id })) }) });
      await openOne(open.id);
      await load();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!open) return;
    const ok = await confirmAsync({ title: t("memoryManager.collections.delete"), body: t("memoryManager.collections.deleteConfirm", { title: open.title }), confirmLabel: t("memoryManager.delete"), tone: "danger" });
    if (!ok) return;
    setBusy(true);
    try {
      await pxMemory(`/collections/${encodeURIComponent(open.id)}`, { method: "DELETE" });
      setOpen(null);
      onSelect?.(null);
      await load();
      onChanged?.();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, by: number) => setItems((current) => {
    const next = [...current];
    const target = index + by;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
  const dirty = open ? items.map((item) => `${item.note_scope}/${item.note_id}`).join("|") !== [...open.items].sort((a, b) => a.rank - b.rank).map((item) => `${item.note_scope}/${item.note_id}`).join("|") : false;

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-hairline/50 bg-panel px-5 pb-6 pt-4" data-memory-collections="">
      {open ? (
        <>
          <button type="button" className="mb-2 inline-flex items-center gap-1.5 self-start text-[13px] text-ink-secondary hover:text-ink" onClick={() => { setOpen(null); onSelect?.(null); }} data-memory-collection-back="">
            <ArrowLeft size={14} aria-hidden="true" />{t("memoryManager.collections.title")}
          </button>
          <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-[20px] font-semibold leading-[1.3] text-ink">{open.title}</h2>
              {open.description && <p className="mt-1 text-[13px] text-ink-secondary">{open.description}</p>}
            </div>
            {open.may_edit && (
              <div className="flex items-center gap-2">
                <button type="button" className={OUTLINE_BUTTON} onClick={() => void remove()} disabled={busy} data-memory-collection-delete=""><Trash2 size={14} aria-hidden="true" />{t("memoryManager.delete")}</button>
                <button type="button" className={PRIMARY_BUTTON} onClick={() => void save()} disabled={busy || !dirty} data-memory-collection-save="">{t("common.save")}</button>
              </div>
            )}
          </header>
          <ol className="flex flex-col" data-memory-collection-items="">
            {items.map((item, index) => (
              <li key={`${item.note_scope}/${item.note_id}`} className="flex items-center gap-2 border-b border-hairline/40 px-2 py-2.5">
                <span className="w-6 text-right text-[12px] tabular-nums text-ink-tertiary">{index + 1}</span>
                <button type="button" disabled={!item.readable} className="min-w-0 flex-1 text-left disabled:opacity-60" onClick={() => onOpenNote(item.note_scope, item.note_id)}>
                  <span className="block truncate text-[14px] font-semibold text-ink">{item.readable ? item.title || t("memoryManager.collections.untitled") : t("memoryManager.collections.unreadable")}</span>
                  {item.topic && <span className="block truncate text-[12px] text-ink-secondary">{item.topic}</span>}
                </button>
                {open.may_edit && (
                  <span className="flex items-center gap-0.5">
                    <button type="button" className={GHOST_BUTTON} aria-label={t("memoryManager.collections.up")} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                    <button type="button" className={GHOST_BUTTON} aria-label={t("memoryManager.collections.down")} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                    <button type="button" className={GHOST_BUTTON} aria-label={t("memoryManager.collections.remove")} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><X size={14} aria-hidden="true" /></button>
                  </span>
                )}
              </li>
            ))}
            {items.length === 0 && <li className="px-2.5 py-8 text-[13px] text-ink-secondary">{t("memoryManager.collections.emptyOne")}</li>}
          </ol>
        </>
      ) : (
        <>
          <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold leading-[1.3] text-ink">{t("memoryManager.collections.title")}</h2>
              <p className="mt-1 text-[13px] text-ink-secondary">{t("memoryManager.collections.hint")}</p>
            </div>
            <button type="button" className={OUTLINE_BUTTON} onClick={() => setCreating(true)} data-memory-collection-new=""><Plus size={14} aria-hidden="true" />{t("memoryManager.collections.new")}</button>
          </header>
          {creating && (
            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-hairline/50 bg-app p-3" data-memory-collection-form="">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("memoryManager.titleField")} aria-label={t("memoryManager.titleField")} className={FIELD} autoFocus />
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("memoryManager.collections.description")} aria-label={t("memoryManager.collections.description")} className={FIELD} />
              <div className="flex justify-end gap-2">
                <button type="button" className={GHOST_BUTTON} onClick={() => setCreating(false)}>{t("common.cancel")}</button>
                <button type="button" className={PRIMARY_BUTTON} disabled={busy || !title.trim()} onClick={() => void create()} data-memory-collection-create="">{t("memoryManager.create")}</button>
              </div>
            </div>
          )}
          <div className="flex flex-col">
            {(list ?? []).map((entry) => (
              <button key={entry.id} type="button" onClick={() => void openOne(entry.id)} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border-b border-hairline/40 px-2.5 py-3 text-left hover:bg-hover" data-memory-collection-row="">
                <BookOpen size={16} className="mt-0.5 text-ink-secondary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink">{entry.title}</span>
                  {entry.description && <span className="block truncate text-[13px] text-ink-secondary">{entry.description}</span>}
                  <span className="mt-0.5 block text-[12px] text-ink-secondary">{t("memoryManager.collections.count", { n: entry.item_count })}</span>
                </span>
                <span className="flex flex-col items-end gap-1.5 whitespace-nowrap text-[12px] text-ink-secondary">
                  {entry.author_name && <AuthorBadge name={entry.author_name} />}
                  {entry.updated_at && <span>{relLabel(Date.parse(entry.updated_at))}</span>}
                </span>
              </button>
            ))}
            {list && list.length === 0 && !creating && <p className="px-2.5 py-8 text-[13px] text-ink-secondary">{t("memoryManager.collections.empty")}</p>}
            {list === null && <p className="px-2.5 py-8 text-[13px] text-ink-secondary">{t("memoryManager.loading")}</p>}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}
