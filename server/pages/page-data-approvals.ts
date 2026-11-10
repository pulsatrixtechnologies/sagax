// Ask first on a page's data read (#3413 review): the server records the
// reader's answer to the card, never a request flag. A read the
// organization asks first about opens a pending approval; only the reader
// themselves, from their own session (never a bot's `act` copy of it),
// answers it. "Allow once" holds for that reader, page, version and source
// for ALLOW_ONCE_MS (memory: a restart asks again, which fails closed);
// "Always allow" is kept on disk per reader, page and source.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** How long a pending card waits for its answer. */
export const PAGE_APPROVAL_PENDING_MS = 10 * 60_000;
/** How long "Allow once" lets the page read again (its refreshes). */
export const PAGE_APPROVAL_ONCE_MS = 12 * 60 * 60_000;
const MAX_ENTRIES = 10_000;

export interface PageDataAsk {
  person: string;
  pageId: string;
  version: number;
  source: string;
}

interface Pending extends PageDataAsk {
  at: number;
}

interface Always {
  person: string;
  pageId: string;
  source: string;
  at: number;
}

const askKey = (ask: PageDataAsk) => `${ask.person.toLowerCase()}\u0000${ask.pageId}\u0000${ask.version}\u0000${ask.source}`;
const alwaysKey = (ask: Pick<PageDataAsk, "person" | "pageId" | "source">) => `${ask.person.toLowerCase()}\u0000${ask.pageId}\u0000${ask.source}`;

export class PageDataApprovals {
  private readonly pending = new Map<string, Pending>();
  private readonly once = new Map<string, number>();
  private always: Map<string, Always> | null = null;
  private readonly file: string | null;
  private readonly now: () => number;

  /** `file`: where "Always allow" is kept; null keeps it in memory (tests). */
  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
  }

  private alwaysMap(): Map<string, Always> {
    if (this.always) return this.always;
    const map = new Map<string, Always>();
    if (this.file && existsSync(this.file)) {
      try {
        const rows = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const entry = row as Partial<Always>;
            if (typeof entry.person === "string" && typeof entry.pageId === "string" && typeof entry.source === "string") {
              map.set(alwaysKey(entry as Always), { person: entry.person, pageId: entry.pageId, source: entry.source, at: Number(entry.at) || 0 });
            }
          }
        }
      } catch {
        // unreadable: nothing is allowed always (fails closed)
      }
    }
    this.always = map;
    return map;
  }

  private saveAlways(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify([...this.alwaysMap().values()], null, 1), { mode: 0o600 });
    renameSync(temp, this.file);
  }

  /** The reader answered yes for this read (once, still valid, or always). */
  allowed(ask: PageDataAsk): boolean {
    if (this.alwaysMap().has(alwaysKey(ask))) return true;
    const until = this.once.get(askKey(ask));
    if (until === undefined) return false;
    if (until < this.now()) {
      this.once.delete(askKey(ask));
      return false;
    }
    return true;
  }

  /** A card for this read: its id (the same while one is pending). */
  open(ask: PageDataAsk): string {
    const at = this.now();
    for (const [id, entry] of this.pending) {
      if (at - entry.at > PAGE_APPROVAL_PENDING_MS) this.pending.delete(id);
      else if (askKey(entry) === askKey(ask)) return id;
    }
    if (this.pending.size >= MAX_ENTRIES) this.pending.delete(this.pending.keys().next().value!);
    const id = randomBytes(12).toString("base64url");
    this.pending.set(id, { ...ask, at });
    return id;
  }

  /** The reader's answer to a pending card: only theirs counts. */
  answer(id: string, person: string, input: { allow: boolean; always?: boolean }): { ok: true; ask: PageDataAsk } | { ok: false; code: "not_found" } {
    const entry = this.pending.get(id);
    if (!entry || entry.person.toLowerCase() !== person.toLowerCase() || this.now() - entry.at > PAGE_APPROVAL_PENDING_MS) return { ok: false, code: "not_found" };
    this.pending.delete(id);
    const { at: _at, ...ask } = entry;
    if (!input.allow) return { ok: true, ask };
    if (input.always) {
      this.alwaysMap().set(alwaysKey(ask), { person: ask.person, pageId: ask.pageId, source: ask.source, at: this.now() });
      this.saveAlways();
    } else {
      if (this.once.size >= MAX_ENTRIES) this.once.delete(this.once.keys().next().value!);
      this.once.set(askKey(ask), this.now() + PAGE_APPROVAL_ONCE_MS);
    }
    return { ok: true, ask };
  }
}
