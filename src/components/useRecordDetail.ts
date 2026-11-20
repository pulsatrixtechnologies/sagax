import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { RECORD_CARD_TTL_MS, recordCardLanguage } from "@/lib/record-cards";
import {
  readDetailCounts, readDetailPage, readFieldChoices, readNoteImage, writeField,
  RECORD_TITLE_FIELD, type RecordEditField,
} from "@/lib/record-detail";
import type { RecordRef } from "../../shared/record-cards";
import type { RecordChoice, RecordFieldEdit } from "./RecordFieldSelect";
import type { RelatedPage } from "./RecordRelatedTabs";
import { useRecordRelatedTabs } from "./useRecordRelatedTabs";

/** A change of one field makes the choices of these stale. */
const DEPENDENTS: Partial<Record<RecordEditField, RecordEditField[]>> = {
  board: ["status", "type", "subtype", "item", "team", "owner"],
  type: ["subtype", "item"],
  subtype: ["item"],
};

/** The title written in place: the console listed it as editable. */
export interface RecordTitleEdit {
  save: (value: string) => Promise<void>;
}

/** The detail of one open ticket card: related tabs, the images its notes
 * name, editable fields and its title, read through the record's detail route. Absent (`enabled` false), or once the
 * server has no such route, `related` and `edits` are undefined and the
 * original card is shown. */
export function useRecordDetail(ref: RecordRef, enabled: boolean, onChanged: () => void) {
  const { product, kind, id } = ref;
  const lang = recordCardLanguage();
  const [fields, setFields] = useState<RecordEditField[]>([]);
  const [titleEditable, setTitleEditable] = useState(false);
  const [saved, setSaved] = useState<Partial<Record<RecordEditField, string>>>({});
  const [stamps, setStamps] = useState<Partial<Record<RecordEditField, number>>>({});
  const [downloadError, setDownloadError] = useState(false);
  const live = useRef<object | undefined>(undefined);
  const choices = useRef(new Map<RecordEditField, { at: number; read: Promise<RecordChoice[]> }>());
  const source = useMemo(() => {
    if (!enabled) return undefined;
    const token = {};
    const record: RecordRef = { product, kind, id };
    return {
      token,
      record,
      async counts(fresh: boolean) {
        const read = await readDetailCounts(record, fresh);
        if (live.current === token) {
          setFields(read.fields);
          setTitleEditable(read.title);
        }
        return read.counts;
      },
      async page(tab: RelatedPage["tab"], fresh: boolean): Promise<RelatedPage> {
        let page = await readDetailPage(record, tab, 1, fresh, () => setDownloadError(true));
        let joined = page.page;
        let next = page.next;
        while (next !== null) {
          page = await readDetailPage(record, tab, next, fresh, () => setDownloadError(true));
          joined = { ...joined, lines: [...joined.lines, ...page.page.lines] } as RelatedPage;
          if (page.next !== null && page.next <= next) throw new Error("invalid detail page");
          next = page.next;
        }
        return joined;
      },
    };
    // the language is part of the key: a language change reads again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, product, kind, id, lang]);
  useEffect(() => {
    live.current = source?.token;
    choices.current = new Map();
    setFields([]);
    setTitleEditable(false);
    setSaved({});
    setStamps({});
    setDownloadError(false);
  }, [source]);
  const tabs = useRecordRelatedTabs(source);
  const refreshTabs = tabs.refresh;
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const edit = useCallback((field: RecordEditField): RecordFieldEdit => ({
    selected: saved[field],
    stamp: stamps[field] ?? 0,
    load: () => {
      if (!source) return Promise.resolve([]);
      const known = choices.current.get(field);
      if (known && Date.now() - known.at < RECORD_CARD_TTL_MS) return known.read;
      const read = readFieldChoices(source.record, field, known !== undefined || (stamps[field] ?? 0) > 0);
      choices.current.set(field, { at: Date.now(), read });
      read.catch(() => { if (choices.current.get(field)?.read === read) choices.current.delete(field); });
      return read;
    },
    save: async (value: string) => {
      if (!source) return;
      await writeField(source.record, field, value);
      // a changed record is not touched by the answer of the one before it
      if (live.current !== source.token) return;
      for (const stale of [field, ...(DEPENDENTS[field] ?? [])]) choices.current.delete(stale);
      const dependents = DEPENDENTS[field] ?? [];
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
      refreshTabs();
    },
  }), [source, saved, stamps, refreshTabs]);

  // the title goes through the same write path, as text; the card is read again after
  const title = useMemo<RecordTitleEdit | undefined>(() => {
    if (!source || tabs.missing || !titleEditable) return undefined;
    return {
      save: async (value: string) => {
        await writeField(source.record, RECORD_TITLE_FIELD, value);
        if (live.current !== source.token) return;
        changed.current();
      },
    };
  }, [source, tabs.missing, titleEditable]);
  // a note's images, read as the person through the same detail route
  const readImage = useMemo(() => source ? (src: string) => readNoteImage(source.record, src) : undefined, [source]);

  const edits = useMemo(() => {
    if (!source || tabs.missing || !fields.length) return undefined;
    return Object.fromEntries(fields.map((field) => [field, edit(field)])) as Partial<Record<RecordEditField, RecordFieldEdit>>;
  }, [source, tabs.missing, fields, edit]);
  const related = useMemo(() => tabs.related && { ...tabs.related, readImage, notice: downloadError ? t("recordCard.related.downloadFailed") : undefined }, [tabs.related, readImage, downloadError]);
  return { related, edits, title, refresh: refreshTabs, missing: tabs.missing };
}
