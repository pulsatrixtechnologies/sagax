// Named data sources a page may read (#3413): each computed on demand by the
// server for the reader who asks, with the reader's own session and rights,
// never the page owner's. Nothing is stored and nothing runs when no page
// asks: no timer, no routine, no periodic write.
//
// Beside the registry, two small in-memory books the data route keeps:
// - PageDataTaint: who received personal data from which page, so their
//   writes to what other readers read (the shared state) are refused on a
//   page that is not private to its person (the design note's first
//   isolation rule).
// - PageDataWatch: which open page reads which bots for whom, so a change of
//   one of those bots sends a `data` event to that person's open stream only.
//   An entry whose page is no longer open is dropped on the next change.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { PageDataSource } from "../../shared/page-capabilities.ts";
import type { PageRecord } from "./published-pages.ts";

export interface PageSourceRead {
  /** The value the page receives. */
  value: unknown;
  /** The bots this answer was read from (the live `data` event's topics). */
  topics: string[];
}

export interface PageSource {
  name: PageDataSource;
  /** What the reader's bar says the page reads. */
  label: string;
  /** Throws PageSourceError for a refusal the reader can act on. */
  read(auth: RequestAuth, input: { params: Record<string, unknown>; fresh: boolean }): Promise<PageSourceRead>;
}

export class PageSourceError extends Error {
  readonly code: "sign_in" | "unavailable" | "bad_request";
  readonly status: number;
  constructor(message: string, code: "sign_in" | "unavailable" | "bad_request", status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class PageSources {
  private readonly sources = new Map<string, PageSource>();

  constructor(sources: readonly PageSource[] = []) {
    for (const source of sources) this.sources.set(source.name, source);
  }

  register(source: PageSource): void {
    this.sources.set(source.name, source);
  }

  get(name: string): PageSource | undefined {
    return this.sources.get(name);
  }

  label(name: string): string | undefined {
    return this.sources.get(name)?.label;
  }
}

/** A page private to its person: shared with nobody (no invite, no editor,
 * not in a bot's Library for others). Pure. */
export function pagePrivateToPerson(page: Pick<PageRecord, "access" | "invites" | "editors" | "botShared">): boolean {
  if (page.access !== "private" || page.botShared === true) return false;
  const invited = (page.invites?.people.length ?? 0) + (page.invites?.teams.length ?? 0);
  return invited === 0 && !(page.editors?.length);
}

/** How long a reader stays marked after personal data reached them on a page. */
export const PAGE_DATA_TAINT_MS = 12 * 60 * 60_000;
const BOOK_MAX = 10_000;

const keyOf = (pageId: string, person: string) => `${pageId}\u0000${person.toLowerCase()}`;

export class PageDataTaint {
  private readonly marks = new Map<string, number>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  mark(pageId: string, person: string): void {
    if (this.marks.size >= BOOK_MAX) this.marks.delete(this.marks.keys().next().value!);
    this.marks.delete(keyOf(pageId, person));
    this.marks.set(keyOf(pageId, person), this.now());
  }

  has(pageId: string, person: string): boolean {
    const at = this.marks.get(keyOf(pageId, person));
    if (at === undefined) return false;
    if (this.now() - at > PAGE_DATA_TAINT_MS) {
      this.marks.delete(keyOf(pageId, person));
      return false;
    }
    return true;
  }
}

interface Watched {
  pageId: string;
  person: string;
  sources: Map<PageDataSource, Set<string>>;
}

/** A person's open page reads these bots; a change of one sends `data`. */
export class PageDataWatch {
  private readonly entries = new Map<string, Watched>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly live: { isOpen(pageId: string, person: string): boolean; data(pageId: string, person: string, name: string): void };
  private readonly debounceMs: number;

  constructor(live: PageDataWatch["live"], debounceMs = 2_000) {
    this.live = live;
    this.debounceMs = debounceMs;
  }

  record(pageId: string, person: string, source: PageDataSource, topics: readonly string[]): void {
    const key = keyOf(pageId, person);
    const entry = this.entries.get(key) ?? { pageId, person, sources: new Map() };
    entry.sources.set(source, new Set(topics));
    if (!this.entries.has(key) && this.entries.size >= BOOK_MAX) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, entry);
  }

  /** One of the person's bots changed (busy, a turn ended). */
  botChanged(botId: string): void {
    for (const [key, entry] of this.entries) {
      if (!this.live.isOpen(entry.pageId, entry.person)) {
        this.entries.delete(key);
        continue;
      }
      for (const [source, topics] of entry.sources) {
        if (!topics.has(botId)) continue;
        const slot = `${key}\u0000${source}`;
        if (this.pending.has(slot)) continue;
        const timer = setTimeout(() => {
          this.pending.delete(slot);
          if (this.live.isOpen(entry.pageId, entry.person)) this.live.data(entry.pageId, entry.person, source);
        }, this.debounceMs);
        timer.unref?.();
        this.pending.set(slot, timer);
      }
    }
  }
}

/** The first isolation rule: a reader who received personal data from this
 * page may not write what other readers read, unless the page is private to
 * its person. Pure. */
export function sharedWriteRefused(page: Pick<PageRecord, "id" | "access" | "invites" | "editors" | "botShared">, person: string, taint: Pick<PageDataTaint, "has">): boolean {
  return taint.has(page.id, person) && !pagePrivateToPerson(page);
}
