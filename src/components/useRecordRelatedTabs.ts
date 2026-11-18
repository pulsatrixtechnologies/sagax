import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { RECORD_CARD_TTL_MS } from "@/lib/record-cards";
import { RecordDetailMissing } from "@/lib/record-detail";
import type { RelatedPage, RelatedTab } from "./RecordRelatedTabs";

type Counts = Partial<Record<RelatedTab, number>>;

export interface RelatedRecordSource {
  counts(fresh: boolean): Promise<Counts>;
  /** every page of the tab, joined (the source follows `next`) */
  page(tab: RelatedPage["tab"], fresh: boolean): Promise<RelatedPage>;
}

/** Mounted for one open record and language: a new `source` starts clean, and
 * an answer of the old one is never shown. A tab switch shares its pending
 * read. Refresh forgets every cached page and reloads only the visible one.
 * `missing` is true once the server has no detail route: the caller shows the
 * original card. */
export function useRecordRelatedTabs(source: RelatedRecordSource | undefined) {
  const [tab, onTab] = useState<RelatedTab>("notes");
  const [revision, setRevision] = useState(0);
  const [missing, setMissing] = useState<RelatedRecordSource>();
  const cache = useRef(new Map<RelatedTab, { at: number; read: Promise<RelatedPage> }>());
  const countRequest = useRef<Promise<Counts> | undefined>(undefined);
  const [counts, setCounts] = useState<Counts>({});
  const [noteCount, setNoteCount] = useState<number>();
  const [page, setPage] = useState<RelatedPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countError, setCountError] = useState("");
  const [schedule, setSchedule] = useState<Extract<RelatedPage, { tab: "schedule" }>["lines"]>();
  const [scheduleError, setScheduleError] = useState("");
  const scheduleRequest = useRef<Promise<RelatedPage> | undefined>(undefined);
  const owner = useRef(source);
  if (owner.current !== source) {
    // another record: nothing of the last one stays
    owner.current = source;
    cache.current = new Map();
    countRequest.current = undefined;
    scheduleRequest.current = undefined;
  }
  const refresh = useCallback(() => {
    cache.current.clear();
    countRequest.current = undefined;
    scheduleRequest.current = undefined;
    setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    setCounts({});
    setNoteCount(undefined);
    setPage(undefined);
    setError("");
    setCountError("");
    onTab("notes");
  }, [source]);
  useEffect(() => {
    if (!source || missing === source) return;
    let current = true;
    setCountError("");
    const request = countRequest.current ??= source.counts(revision > 0);
    request.then(result => {
      if (current && countRequest.current === request) setCounts(result);
    }, (failure: unknown) => {
      if (failure instanceof RecordDetailMissing) { if (current) setMissing(source); return; }
      if (countRequest.current === request) countRequest.current = undefined;
      if (current) setCountError(t("recordCard.related.loadFailed"));
    });
    return () => { current = false; };
  }, [source, revision, missing]);
  useEffect(() => {
    if (!source || missing === source) return;
    let current = true;
    let entry = cache.current.get(tab);
    if (!entry || Date.now() - entry.at >= RECORD_CARD_TTL_MS) {
      entry = { at: Date.now(), read: source.page(tab, revision > 0) };
      cache.current.set(tab, entry);
    }
    const mine = entry;
    const store = cache.current;
    setError("");
    setLoading(true);
    mine.read.then(result => {
      if (current) {
        if (result.tab === "notes") setNoteCount(result.lines.length);
        setPage(result);
        setLoading(false);
      }
    }, (failure: unknown) => {
      if (store.get(tab) === mine) store.delete(tab);
      if (!current) return;
      if (failure instanceof RecordDetailMissing) setMissing(source);
      else setError(t("recordCard.related.loadFailed"));
      setLoading(false);
    });
    return () => { current = false; };
  }, [source, revision, tab, missing]);
  useEffect(() => {
    setSchedule(undefined);
    setScheduleError("");
    if (!source || missing === source) return;
    let current = true;
    const request = scheduleRequest.current ??= source.page("schedule", revision > 0);
    request.then(result => {
      if (current && result.tab === "schedule") setSchedule(result.lines);
    }, () => {
      if (current) setScheduleError(t("recordCard.related.loadFailed"));
    });
    return () => { current = false; };
  }, [source, revision, missing]);
  const gone = !source || missing === source;
  return { related: gone ? undefined : { counts: { ...counts, notes: noteCount ?? counts.notes }, tab, onTab, page, loading, error, countError, schedule, scheduleError }, refresh, missing: Boolean(source) && missing === source };
}
