// The detail of one open record window of another plugin (M-20261127-141,
// M-20261127-146): its counts and the writes the console takes, the sections
// its tabs read (the window's shared core, useDetailSections.ts: on demand,
// kept for the card's time to live), a file's or a recording's bytes (the
// one reader, `readDetailBytes`), and its writes (shared/record-actions.ts).
// The same route as a ticket's tabs (src/lib/record-detail.ts): the console
// reads the record as the person.
//
// A console that serves no detail for the kind (404 `kind_unknown`, or no
// route at all) leaves the window to the frame's own view of the card:
// `served` is false and no section is read. A section the console refuses is
// that section's only: its tab is hidden (M-20261127-143). A write is offered
// only when the console lists it in `actions`: a console that lists none
// offers none.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordCardLanguage } from "@/lib/record-cards";
import { detailRouteMissing, readDetailBytes, recordDetailPath, writeAction } from "@/lib/record-detail";
import { api, ApiError } from "@/state/store";
import type { RecordRef } from "../../../../shared/record-cards";
import { parseRecordActions, type RecordAction, type RecordActionName } from "../../../../shared/record-actions";
import { useDetailSections, type SectionState } from "../useDetailSections";

export interface PluginSectionState extends SectionState<unknown> {
  /** the section as the console sent it, its pages' lines joined */
  data?: unknown;
}

export interface PluginDetail {
  /** the console serves a detail for this kind (undefined: still asking) */
  served: boolean | undefined;
  counts: Readonly<Record<string, number>>;
  /** the console lists this write for the record */
  can: (action: RecordActionName) => boolean;
  section: (name: string) => PluginSectionState;
  /** read these sections now (a tab opened) */
  want: (names: readonly string[]) => void;
  write: (action: RecordAction) => Promise<void>;
  /** a file's bytes (an attachment, a recording, an image), through the same route */
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
const NO_COUNTS: Readonly<Record<string, number>> = {};
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
  if (!SECTION.test(name)) throw new Error("not a section");
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
  // the console's answer for one record (its token): another record starts from no answer, never the last one's
  const [answer, setAnswer] = useState<{ token?: object; served?: boolean; counts: Record<string, number>; actions: ReadonlySet<RecordActionName> | null }>({ counts: {}, actions: null });
  const own = answer.token !== undefined && answer.token === source?.token;
  const served = own ? answer.served : undefined;
  const counts = own ? answer.counts : NO_COUNTS;
  const actions = own ? answer.actions : null;
  const [revision, setRevision] = useState(0);
  const sections = useDetailSections<string, unknown>(source, readSection, (error) => refusedByConsole(error) ? "refused" : "failed", () => {});
  const { section: sectionOf, want: wantNow, refresh: refreshSections, loadWanted, reread, live } = sections;
  const changed = useRef(onChanged);
  changed.current = onChanged;
  // one write of the same action at a time (the two Isolate buttons of a threat ask once)
  const inflight = useRef(new Map<string, Promise<void>>());
  const servedNow = useRef(served);
  servedNow.current = served;

  // the counts first: they say whether the console serves this kind at all
  useEffect(() => {
    if (!source) return;
    let current = true;
    api<unknown>(recordDetailPath(source.record, { section: "counts", fresh: revision > 0 ? 1 : undefined })).then((raw) => {
      if (!current) return;
      const given = isObject(raw) && isObject(raw.counts) ? raw.counts : {};
      servedNow.current = true;
      setAnswer({
        token: source.token, served: true,
        counts: Object.fromEntries(Object.entries(given).filter(([key, value]) => SECTION.test(key) && typeof value === "number" && Number.isInteger(value) && value >= 0)) as Record<string, number>,
        actions: parseRecordActions(isObject(raw) ? raw.actions : undefined),
      });
      // the sections asked while the counts were read
      loadWanted();
    }, () => {
      // a console with no detail for this kind (or none reachable): the frame's own view of the card
      if (current && servedNow.current === undefined) setAnswer({ token: source.token, served: false, counts: {}, actions: null });
    });
    return () => { current = false; };
  }, [source, revision, loadWanted]);

  const bytes = useCallback(async (section: string, field: string) => (await readDetailBytes(source!.record, section, field)).blob, [source]);
  // stable: a tab's effect asks again only when its tab or the console's answer changes
  const want = useCallback((names: readonly string[]) => wantNow(names, servedNow.current === true), [wantNow]);
  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
    refreshSections(servedNow.current === true);
  }, [refreshSections]);

  return useMemo<PluginDetail | undefined>(() => {
    if (!source) return undefined;
    return {
      served,
      counts,
      can: (action) => served === true && actions !== null && actions.has(action),
      section: (name) => {
        const state = sectionOf(name);
        if (state) return { ...state, data: state.page };
        return served === false ? { loading: false, error: "", refused: true } : { loading: served === undefined || SECTION.test(name), error: "" };
      },
      want,
      write: (action) => {
        const key = JSON.stringify(action);
        const running = inflight.current.get(key);
        if (running) return running;
        const run = (async () => {
          await writeAction(source.record, action);
          if (live.current !== source.token) return;
          reread(CHANGES[action.action.split(".")[0]!] ?? []);
          setRevision((value) => value + 1);
          changed.current();
        })().finally(() => { inflight.current.delete(key); });
        inflight.current.set(key, run);
        return run;
      },
      bytes,
      refresh,
    };
  }, [source, served, counts, actions, sectionOf, want, reread, refresh, live, bytes]);
}
