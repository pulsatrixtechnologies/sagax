// The detail of one open record window (M-20261127-101: a ticket, a company,
// a contact): its counts, the
// sections each tab reads (on demand, a section kept for the card's time to
// live, every page of it joined), the choices of a field or a form, the
// field writes, the title written in place and the window's actions (a note,
// a time entry, an expense, a planned entry, a configuration, an attachment,
// shared/record-actions.ts). Mounted for one record and language: another
// record starts clean and an answer for the last one is never shown. Absent
// (`enabled` false), or once the server has no detail route, `detail` and
// `edits` are undefined and the original card is shown.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { RECORD_CARD_TTL_MS, recordCardLanguage } from "@/lib/record-cards";
import {
  readDetailCounts, readDetailPage, readFieldChoices, readNoteImage, writeAction, writeField,
  RECORD_TITLE_FIELD, RecordDetailMissing, type DetailPage, type DetailPageOf, type DetailSection, type RecordChoice, type RecordEditField,
} from "@/lib/record-detail";
import type { RecordRef } from "../../shared/record-cards";
import type { RecordAction, RecordActionChoice, RecordActionName } from "../../shared/record-actions";
import type { RecordFieldEdit } from "./RecordFieldSelect";

/** A change of one field makes the choices of these stale. */
const DEPENDENTS: Partial<Record<RecordEditField, RecordEditField[]>> = {
  board: ["status", "type", "subtype", "item", "team", "owner"],
  type: ["subtype", "item"],
  subtype: ["item"],
};

/** The sections an action changes: read again once it is written, when the window showed them
 * (a company's sheet says what moved and what comes, so most writes change it too). */
const CHANGES: Record<string, DetailSection[]> = {
  note: ["notes", "sheet"],
  time: ["time"],
  expense: ["expenses"],
  schedule: ["schedule", "activities", "sheet"],
  configuration: ["configurations"],
  attachment: ["attachments", "sheet"],
  contact: ["contacts", "sheet"],
  site: ["sites", "sheet"],
  payment: ["payments", "document", "history"],
};

/** The title written in place: the console listed it as editable. */
export interface RecordTitleEdit {
  save: (value: string) => Promise<void>;
}

export interface DetailSectionState<K extends DetailSection> {
  page?: DetailPageOf<K>;
  loading: boolean;
  error: string;
}

export interface RecordDetail {
  counts: Partial<Record<DetailSection, number>>;
  /** the counts answer came: the tabs it names can be drawn (a company's tabs wait for it) */
  known: boolean;
  countError: string;
  /** the counts answered: the tabs and the actions the console takes are known */
  ready: boolean;
  /** the console takes this action for the record (a console that lists none: any is tried) */
  can: (action: RecordActionName) => boolean;
  section: <K extends DetailSection>(tab: K) => DetailSectionState<K>;
  /** read these sections now (a tab opened) */
  want: (tabs: readonly DetailSection[]) => void;
  write: (action: RecordAction) => Promise<void>;
  choices: (field: RecordActionChoice) => Promise<RecordChoice[]>;
  /** a note's image, read as the person through the card's detail route (never the product from the browser) */
  readImage?: (src: string) => Promise<Blob>;
  /** an attachment that could not be downloaded */
  notice?: string;
}

type Entry = { at: number; read: Promise<DetailPage> };

export function useRecordDetail(ref: RecordRef, enabled: boolean, onChanged: () => void) {
  const { product, kind, id } = ref;
  const lang = recordCardLanguage();
  const [fields, setFields] = useState<RecordEditField[]>([]);
  const [titleEditable, setTitleEditable] = useState(false);
  const [actions, setActions] = useState<ReadonlySet<RecordActionName> | null>(null);
  const [counts, setCounts] = useState<Partial<Record<DetailSection, number>>>({});
  const [countsKnown, setCountsKnown] = useState(false);
  const [countError, setCountError] = useState("");
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  // the sections read, for one record: a page of another record (the one before) is never shown
  const [pages, setPages] = useState<{ token?: object; map: Partial<Record<DetailSection, DetailSectionState<DetailSection>>> }>({ map: {} });
  const [saved, setSaved] = useState<Partial<Record<RecordEditField, string>>>({});
  const [stamps, setStamps] = useState<Partial<Record<RecordEditField, number>>>({});
  const [downloadError, setDownloadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const cache = useRef(new Map<DetailSection, Entry>());
  const wanted = useRef(new Set<DetailSection>());
  // a section a write changed while the window did not show it: read fresh when it is shown
  const changedUnseen = useRef(new Set<DetailSection>());
  const choiceCache = useRef(new Map<string, { at: number; read: Promise<RecordChoice[]> }>());
  const source = useMemo(() => {
    if (!enabled) return undefined;
    return { token: {}, record: { product, kind, id } as RecordRef };
    // the language is part of the key: a language change reads again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, product, kind, id, lang]);
  const live = useRef(source?.token);
  if (live.current !== source?.token) {
    // another record: nothing kept of the last one (before any child asks for a section)
    cache.current = new Map();
    wanted.current = new Set();
    changedUnseen.current = new Set();
    choiceCache.current = new Map();
  }
  live.current = source?.token;
  const changed = useRef(onChanged);
  changed.current = onChanged;

  // another record: nothing of the last one stays
  useEffect(() => {
    setFields([]);
    setTitleEditable(false);
    setActions(null);
    setCounts({});
    setCountsKnown(false);
    setCountError("");
    setReady(false);
    setMissing(false);
    setSaved({});
    setStamps({});
    setDownloadError(false);
  }, [source]);

  const load = useCallback((tab: DetailSection, fresh: boolean) => {
    if (!source) return;
    let entry = cache.current.get(tab);
    if (fresh || !entry || Date.now() - entry.at >= RECORD_CARD_TTL_MS) {
      const read = (async () => {
        let page = await readDetailPage(source.record, tab, 1, fresh, () => setDownloadError(true));
        let joined = page.page;
        let next = page.next;
        while (next !== null) {
          page = await readDetailPage(source.record, tab, next, fresh, () => setDownloadError(true));
          joined = { ...joined, lines: [...joined.lines, ...page.page.lines] } as DetailPage;
          if (page.next !== null && page.next <= next) throw new Error("invalid detail page");
          next = page.next;
        }
        return joined;
      })();
      entry = { at: Date.now(), read };
      cache.current.set(tab, entry);
    }
    const mine = entry;
    const token = source.token;
    const put = (next: (before: DetailSectionState<DetailSection> | undefined) => DetailSectionState<DetailSection>) =>
      setPages((now) => {
        const map = now.token === token ? now.map : {};
        return { token, map: { ...map, [tab]: next(map[tab]) } };
      });
    put((before) => ({ ...before, loading: true, error: "" }));
    mine.read.then((page) => {
      if (live.current !== token || cache.current.get(tab) !== mine) return;
      put(() => ({ page, loading: false, error: "" }));
    }, (failure: unknown) => {
      if (cache.current.get(tab) === mine) cache.current.delete(tab);
      if (live.current !== token) return;
      if (failure instanceof RecordDetailMissing) { setMissing(true); return; }
      put((before) => ({ ...before, loading: false, error: t("recordCard.related.loadFailed") }));
    });
  }, [source]);

  // the counts (and with them the editable fields, the title and the actions the console takes)
  useEffect(() => {
    if (!source) return;
    let current = true;
    setCountError("");
    readDetailCounts(source.record, revision > 0).then((read) => {
      if (!current) return;
      setCounts(read.counts);
      setCountsKnown(true);
      setFields(read.fields);
      setTitleEditable(read.title);
      setActions(read.actions);
      setReady(true);
    }, (failure: unknown) => {
      if (!current) return;
      if (failure instanceof RecordDetailMissing) setMissing(true);
      else setCountError(t("recordCard.related.loadFailed"));
    });
    return () => { current = false; };
  }, [source, revision]);

  const want = useCallback((tabs: readonly DetailSection[]) => {
    for (const tab of tabs) {
      wanted.current.add(tab);
      const entry = cache.current.get(tab);
      const fresh = changedUnseen.current.delete(tab);
      if (fresh || !entry || Date.now() - entry.at >= RECORD_CARD_TTL_MS) load(tab, fresh);
    }
  }, [load]);

  /** Refresh forgets every kept section and reads again the ones the window showed. */
  const refresh = useCallback(() => {
    cache.current.clear();
    choiceCache.current.clear();
    setRevision((value) => value + 1);
    for (const tab of wanted.current) load(tab, true);
  }, [load]);

  const edit = useCallback((field: RecordEditField): RecordFieldEdit => ({
    selected: saved[field],
    stamp: stamps[field] ?? 0,
    load: () => {
      if (!source) return Promise.resolve([]);
      const known = choiceCache.current.get(field);
      if (known && Date.now() - known.at < RECORD_CARD_TTL_MS) return known.read;
      const read = readFieldChoices(source.record, field, known !== undefined || (stamps[field] ?? 0) > 0);
      choiceCache.current.set(field, { at: Date.now(), read });
      read.catch(() => { if (choiceCache.current.get(field)?.read === read) choiceCache.current.delete(field); });
      return read;
    },
    save: async (value: string) => {
      if (!source) return;
      await writeField(source.record, field, value);
      // a changed record is not touched by the answer of the one before it
      if (live.current !== source.token) return;
      const dependents = DEPENDENTS[field] ?? [];
      for (const stale of [field, ...dependents]) choiceCache.current.delete(stale);
      setSaved((now) => {
        const next = { ...now, [field]: value };
        for (const stale of dependents) delete next[stale];
        return next;
      });
      setStamps((now) => {
        const next = { ...now };
        for (const stale of [field, ...dependents]) next[stale] = (next[stale] ?? 0) + 1;
        return next;
      });
      changed.current();
    },
  }), [source, saved, stamps]);

  // the title goes through the same write path, as text; the card is read again after
  const title = useMemo<RecordTitleEdit | undefined>(() => {
    if (!source || missing || !titleEditable) return undefined;
    return {
      save: async (value: string) => {
        await writeField(source.record, RECORD_TITLE_FIELD, value);
        if (live.current !== source.token) return;
        changed.current();
      },
    };
  }, [source, missing, titleEditable]);

  const edits = useMemo(() => {
    if (!source || missing || !fields.length) return undefined;
    return Object.fromEntries(fields.map((field) => [field, edit(field)])) as Partial<Record<RecordEditField, RecordFieldEdit>>;
  }, [source, missing, fields, edit]);

  const detail = useMemo<RecordDetail | undefined>(() => {
    if (!source || missing) return undefined;
    return {
      counts,
      known: countsKnown,
      countError,
      ready,
      can: (action) => actions === null || actions.has(action),
      section: <K extends DetailSection>(tab: K) => ((pages.token === source.token ? pages.map[tab] : undefined) ?? { loading: true, error: "" }) as unknown as DetailSectionState<K>,
      want,
      write: async (action) => {
        await writeAction(source.record, action);
        if (live.current !== source.token) return;
        for (const tab of CHANGES[action.action.split(".")[0]!] ?? []) {
          if (wanted.current.has(tab)) load(tab, true);
          else { cache.current.delete(tab); changedUnseen.current.add(tab); }
        }
        // the counts, the card's own facts (its hours) and a note's time follow the write
        setRevision((value) => value + 1);
        changed.current();
      },
      choices: (field) => {
        const known = choiceCache.current.get(field);
        if (known && Date.now() - known.at < RECORD_CARD_TTL_MS) return known.read;
        const read = readFieldChoices(source.record, field, false);
        choiceCache.current.set(field, { at: Date.now(), read });
        read.catch(() => { if (choiceCache.current.get(field)?.read === read) choiceCache.current.delete(field); });
        return read;
      },
      readImage: (src) => readNoteImage(source.record, src),
      notice: downloadError ? t("recordCard.related.downloadFailed") : undefined,
    };
  }, [source, missing, counts, countsKnown, countError, ready, actions, pages, want, load, downloadError]);

  return { detail, edits, title, refresh, missing };
}
