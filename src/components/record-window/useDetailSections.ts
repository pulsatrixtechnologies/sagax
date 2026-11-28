// The sections a record window reads through the record's detail route, for
// every kind (a ticket's tabs, useRecordDetail.ts; another plugin's,
// plugins/usePluginDetail.ts): each read on demand, kept for the card's time
// to live, one read in flight per section, never an answer of the record
// before shown for the next one (the source's token), and Refresh reading
// again the sections the window showed. How a section is read (its pages
// joined, its parse) and what a failure means are the caller's.
import { useCallback, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { RECORD_CARD_TTL_MS } from "@/lib/record-cards";
import type { RecordRef } from "../../../shared/record-cards";

/** One record read by a window: a new token is a new record (or language), nothing of the last one kept. */
export interface DetailSource { token: object; record: RecordRef }

export interface SectionState<V> {
  page?: V;
  loading: boolean;
  error: string;
  /** the console does not serve this section for the record */
  refused?: boolean;
}

/** What a failed read is: the route is not there (the caller's own state), the console refuses the section, or a failure to show. */
export type SectionFailure = "missing" | "refused" | "failed";

export function useDetailSections<S extends string, V>(
  source: DetailSource | undefined,
  read: (record: RecordRef, name: S, fresh: boolean) => Promise<V>,
  failure: (error: unknown) => SectionFailure,
  onMissing: () => void,
) {
  const [pages, setPages] = useState<{ token?: object; map: Partial<Record<S, SectionState<V>>> }>({ map: {} });
  const cache = useRef(new Map<S, { at: number; read: Promise<V> }>());
  const wanted = useRef(new Set<S>());
  const live = useRef(source?.token);
  if (live.current !== source?.token) {
    // another record: nothing kept of the last one (before any child asks for a section)
    cache.current = new Map();
    wanted.current = new Set();
  }
  live.current = source?.token;
  const reader = useRef(read);
  reader.current = read;
  const classify = useRef(failure);
  classify.current = failure;
  const missing = useRef(onMissing);
  missing.current = onMissing;

  const load = useCallback((name: S, fresh: boolean) => {
    if (!source) return;
    let entry = cache.current.get(name);
    if (fresh || !entry || Date.now() - entry.at >= RECORD_CARD_TTL_MS) {
      entry = { at: Date.now(), read: reader.current(source.record, name, fresh) };
      cache.current.set(name, entry);
    }
    const mine = entry;
    const token = source.token;
    const put = (next: (before?: SectionState<V>) => SectionState<V>) => setPages((now) => {
      const map: Partial<Record<S, SectionState<V>>> = now.token === token ? now.map : {};
      return { token, map: { ...map, [name]: next(map[name]) } };
    });
    put((before) => ({ ...before, loading: true, error: "" }));
    mine.read.then((page) => {
      if (live.current !== token || cache.current.get(name) !== mine) return;
      put(() => ({ page, loading: false, error: "" }));
    }, (error: unknown) => {
      if (cache.current.get(name) === mine) cache.current.delete(name);
      if (live.current !== token) return;
      const kind = classify.current(error);
      if (kind === "missing") { missing.current(); return; }
      put((before) => kind === "refused" ? { loading: false, error: "", refused: true } : { ...before, loading: false, error: t("recordCard.related.loadFailed") });
    });
  }, [source]);

  /** Read these sections now (a tab opened); `now` false only notes them, for a read once the window may. */
  const want = useCallback((names: readonly S[], now = true) => {
    for (const name of names) {
      wanted.current.add(name);
      if (!now) continue;
      const entry = cache.current.get(name);
      if (!entry || Date.now() - entry.at >= RECORD_CARD_TTL_MS) load(name, false);
    }
  }, [load]);

  /** Forget every kept section and read again the ones the window showed (`now` false: forget only). */
  const refresh = useCallback((now = true) => {
    cache.current.clear();
    if (now) for (const name of wanted.current) load(name, true);
  }, [load]);

  /** Read the sections the window asked for that are not read yet (once the window may read). */
  const loadWanted = useCallback(() => {
    for (const name of wanted.current) if (!cache.current.has(name)) load(name, false);
  }, [load]);

  /** A section changed by a write: read again if the window showed it. */
  const reread = useCallback((names: readonly S[]) => {
    for (const name of names) if (wanted.current.has(name)) load(name, true);
  }, [load]);

  const section = useCallback((name: S): SectionState<V> | undefined => (source && pages.token === source.token ? pages.map[name] : undefined), [source, pages]);

  return { section, pages, want, load, refresh, loadWanted, reread, live };
}
