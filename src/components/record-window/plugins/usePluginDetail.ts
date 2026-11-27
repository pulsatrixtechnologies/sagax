// The detail of one open record window of another plugin (M-20261127-141,
// M-20261127-146): its counts and the writes the console takes, the sections
// its tabs read (on demand, kept for the card's time to live, every page
// joined), a file's or a recording's bytes, and its writes
// (shared/record-actions.ts). The same route as a ticket's tabs
// (src/lib/record-detail.ts): the console reads the record as the person.
//
// A console that serves no detail for the kind (404 `kind_unknown`, or no
// route at all) leaves the window to the card's own facts: `served` is false,
// no section is read, no write is offered. A section the console refuses is
// that section's only: its tab is hidden (M-20261127-143), the others stay.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { RECORD_CARD_TTL_MS, recordCardLanguage } from "@/lib/record-cards";
import { detailRouteMissing, recordDetailPath, writeAction } from "@/lib/record-detail";
import { api, ApiError } from "@/state/store";
import type { RecordRef } from "../../../../shared/record-cards";
import { parseRecordActions, type RecordAction, type RecordActionName } from "../../../../shared/record-actions";

export interface PluginSectionState {
  /** the section as the console sent it, its pages' lines joined */
  data?: unknown;
  loading: boolean;
  error: string;
  /** the console does not serve this section for the record */
  refused?: boolean;
}

export interface PluginDetail {
  /** the console serves a detail for this kind (undefined: still asking) */
  served: boolean | undefined;
  counts: Readonly<Record<string, number>>;
  /** the console takes this write for the record (one that lists none: any is tried) */
  can: (action: RecordActionName) => boolean;
  section: (name: string) => PluginSectionState;
  /** read these sections now (a tab opened) */
  want: (names: readonly string[]) => void;
  write: (action: RecordAction) => Promise<void>;
  /** a file's bytes (an attachment, a recording), through the same route */
  bytes: (section: string, field: string) => Promise<Blob>;
  refresh: () => void;
}

/** The sections a write changes: read again once it is written. */
const CHANGES: Record<string, readonly string[]> = {
  threat: ["view", "timeline"],
  note: ["notes"],
  attachment: ["attachments"],
  backup: ["view", "restore_points"],
  message: ["conversation", "log"],
  post: ["view", "replies"],
};

const SECTION = /^[a-z][a-z_]{0,39}$/;
const PAGES_MOST = 20;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A refusal of the console for this record (its code), not a failure of the network. */
function refusedByConsole(error: unknown): boolean {
  if (detailRouteMissing(error)) return true;
  if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 400 && error.status !== 403)) return false;
  const body = error.body as { code?: unknown } | undefined;
  return Boolean(body && typeof body.code === "string");
}

/** One section read whole: its first page's fields, every page's lines. */
async function readSection(ref: RecordRef, name: string, fresh: boolean): Promise<unknown> {
  let page = 1;
  let first: Record<string, unknown> | undefined;
  const lines: unknown[] = [];
  for (let read = 0; read < PAGES_MOST; read += 1) {
    const raw = await api<unknown>(recordDetailPath(ref, { section: name, page, fresh: fresh ? 1 : undefined }));
    if (!isObject(raw)) break;
    first ??= raw;
    if (Array.isArray(raw.lines)) lines.push(...raw.lines);
    const next = typeof raw.next === "number" && Number.isInteger(raw.next) && raw.next > page ? raw.next : null;
    if (next === null) break;
    page = next;
  }
  return first && Array.isArray(first.lines) ? { ...first, lines } : first;
}

export function usePluginDetail(ref: RecordRef, enabled: boolean, onChanged: () => void): PluginDetail | undefined {
  const { product, kind, id } = ref;
  const lang = recordCardLanguage();
  const source = useMemo(() => (enabled ? { token: {}, record: { product, kind, id } as RecordRef } : undefined),
    // the language is part of the key: a language change reads again
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, product, kind, id, lang]);
  const [served, setServed] = useState<boolean | undefined>(undefined);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [actions, setActions] = useState<ReadonlySet<RecordActionName> | null>(null);
  const [sections, setSections] = useState<{ token?: object; map: Record<string, PluginSectionState> }>({ map: {} });
  const [revision, setRevision] = useState(0);
  const cache = useRef(new Map<string, { at: number; read: Promise<unknown> }>());
  const wanted = useRef(new Set<string>());
  const live = useRef(source?.token);
  if (live.current !== source?.token) {
    cache.current = new Map();
    wanted.current = new Set();
  }
  live.current = source?.token;
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const servedNow = useRef(served);
  servedNow.current = served;

  useEffect(() => {
    setServed(undefined);
    setCounts({});
    setActions(null);
  }, [source]);

  const load = useCallback((name: string, fresh: boolean) => {
    if (!source || !SECTION.test(name)) return;
    let entry = cache.current.get(name);
    if (fresh || !entry || Date.now() - entry.at >= RECORD_CARD_TTL_MS) {
      entry = { at: Date.now(), read: readSection(source.record, name, fresh) };
      cache.current.set(name, entry);
    }
    const mine = entry;
    const token = source.token;
    const put = (next: (before?: PluginSectionState) => PluginSectionState) => setSections((now) => {
      const map = now.token === token ? now.map : {};
      return { token, map: { ...map, [name]: next(map[name]) } };
    });
    put((before) => ({ ...before, loading: true, error: "" }));
    mine.read.then((data) => {
      if (live.current !== token || cache.current.get(name) !== mine) return;
      put(() => ({ data, loading: false, error: "" }));
    }, (failure: unknown) => {
      if (cache.current.get(name) === mine) cache.current.delete(name);
      if (live.current !== token) return;
      put(() => refusedByConsole(failure) ? { loading: false, error: "", refused: true } : { loading: false, error: t("recordCard.related.loadFailed") });
    });
  }, [source]);

  // the counts first: they say whether the console serves this kind at all
  useEffect(() => {
    if (!source) return;
    let current = true;
    api<unknown>(recordDetailPath(source.record, { section: "counts", fresh: revision > 0 ? 1 : undefined })).then((raw) => {
      if (!current) return;
      const given = isObject(raw) && isObject(raw.counts) ? raw.counts : {};
      setCounts(Object.fromEntries(Object.entries(given).filter(([key, value]) => SECTION.test(key) && typeof value === "number" && Number.isInteger(value) && value >= 0)) as Record<string, number>);
      setActions(parseRecordActions(isObject(raw) ? raw.actions : undefined));
      setServed(true);
      // the sections asked while the counts were read
      for (const name of wanted.current) if (!cache.current.has(name)) load(name, false);
    }, () => {
      // a console with no detail for this kind (or none reachable): the card's own facts
      if (current && servedNow.current === undefined) setServed(false);
    });
    return () => { current = false; };
  }, [source, revision, load]);

  const want = useCallback((names: readonly string[]) => {
    for (const name of names) {
      wanted.current.add(name);
      if (servedNow.current !== true) continue;
      const entry = cache.current.get(name);
      if (!entry || Date.now() - entry.at >= RECORD_CARD_TTL_MS) load(name, false);
    }
  }, [load]);

  const refresh = useCallback(() => {
    cache.current.clear();
    setRevision((value) => value + 1);
    if (servedNow.current) for (const name of wanted.current) load(name, true);
  }, [load]);

  return useMemo<PluginDetail | undefined>(() => {
    if (!source) return undefined;
    return {
      served,
      counts,
      can: (action) => served === true && (actions === null || actions.has(action)),
      section: (name) => (sections.token === source.token ? sections.map[name] : undefined) ?? { loading: served !== false, error: "", ...(served === false ? { refused: true } : {}) },
      want,
      write: async (action) => {
        await writeAction(source.record, action);
        if (live.current !== source.token) return;
        for (const name of CHANGES[action.action.split(".")[0]!] ?? []) if (wanted.current.has(name)) load(name, true);
        setRevision((value) => value + 1);
        changed.current();
      },
      bytes: async (section, field) => {
        const body = await api<unknown>(recordDetailPath(source.record, { section, field }));
        if (!isObject(body) || typeof body.base64 !== "string") throw new Error("missing file");
        return new Blob([Uint8Array.from(atob(body.base64), (char) => char.charCodeAt(0))], { type: typeof body.contentType === "string" ? body.contentType : "" });
      },
      refresh,
    };
  }, [source, served, counts, actions, sections, want, load, refresh]);
}
