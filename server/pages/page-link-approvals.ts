// "Always allow this site" on a page's link card (#3413): the reader's own
// answer, kept on disk per reader, page and origin (scheme, host and port,
// as shared/page-capabilities.ts normalizePageLinkOrigin gives it: never
// another scheme, port, subdomain or host). The person forgets one with
// DELETE; revoking or deleting the page forgets all of its approvals
// (forgetPage).
//
// Bounds (second review): at most PAGE_LINK_APPROVALS_PER_READER_PAGE sites
// per reader and page, and PAGE_LINK_APPROVALS_PER_READER per reader; past
// either, that reader's own oldest go, never anyone else's. The global cap is
// a net only: at it, a new approval is refused, nobody's row is dropped.
//
// Storage: an append-only journal (one JSON line per answer: allow, forget,
// forget page), so an answer writes one short line instead of the whole
// file. Read back by replaying it; an unreadable line is skipped, the ones
// after it still count. When the journal holds many more lines than live
// rows, or ends in a line a crash cut (no new line at its end), the next
// write compacts it: the live rows written to a temporary file then renamed
// (atomic), so nothing is ever appended to a cut line. No timer.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Sites one reader keeps for one page (decided). */
export const PAGE_LINK_APPROVALS_PER_READER_PAGE = 50;
/** Sites one reader keeps over every page. */
export const PAGE_LINK_APPROVALS_PER_READER = 2_000;
/** The whole store's net: past it, new approvals are refused. */
export const PAGE_LINK_APPROVALS_MAX = 200_000;
const COMPACT_SLACK = 1_000;

interface Row {
  person: string;
  pageId: string;
  origin: string;
  at: number;
}

type Op =
  | { op: "allow"; person: string; pageId: string; origin: string; at: number }
  | { op: "forget"; person: string; pageId: string; origin: string }
  | { op: "forgetPage"; pageId: string };

const keyOf = (person: string, pageId: string, origin: string) => `${person.toLowerCase()}\u0000${pageId}\u0000${origin}`;

export class PageLinkApprovals {
  private rows: Map<string, Row> | null = null;
  private journalLines = 0;
  /** The journal ends in a cut line (a crash or a full disk mid append):
   * the next write compacts it instead of appending to that line. */
  private cut = false;
  private readonly file: string | null;
  private readonly now: () => number;

  /** `file`: the journal; null keeps everything in memory (tests). */
  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
  }

  private map(): Map<string, Row> {
    if (this.rows) return this.rows;
    const map = new Map<string, Row>();
    if (this.file && existsSync(this.file)) {
      let text = "";
      try {
        text = readFileSync(this.file, "utf8");
      } catch {
        // unreadable: nothing is allowed (fails closed)
      }
      this.cut = text.length > 0 && !text.endsWith("\n");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        this.journalLines++;
        let op: Partial<Op> & Record<string, unknown>;
        try {
          op = JSON.parse(line) as Partial<Op> & Record<string, unknown>;
        } catch {
          continue;
        }
        this.apply(map, op);
      }
    }
    this.rows = map;
    return map;
  }

  private apply(map: Map<string, Row>, op: Partial<Op> & Record<string, unknown>): void {
    if (op.op === "forgetPage" && typeof op.pageId === "string") {
      for (const [key, row] of map) if (row.pageId === op.pageId) map.delete(key);
      return;
    }
    if (typeof op.person !== "string" || typeof op.pageId !== "string" || typeof op.origin !== "string") return;
    const key = keyOf(op.person, op.pageId, op.origin);
    if (op.op === "forget") map.delete(key);
    else if (op.op === "allow") {
      map.delete(key);
      map.set(key, { person: op.person, pageId: op.pageId, origin: op.origin, at: Number(op.at) || 0 });
    }
  }

  private write(op: Op): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const map = this.map();
    if (this.cut || this.journalLines + 1 > map.size * 2 + COMPACT_SLACK) {
      const temp = `${this.file}.tmp`;
      const lines = [...map.values()].map((row) => JSON.stringify({ op: "allow", ...row }));
      writeFileSync(temp, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
      renameSync(temp, this.file);
      this.journalLines = lines.length;
      this.cut = false;
      return;
    }
    appendFileSync(this.file, `${JSON.stringify(op)}\n`, { mode: 0o600 });
    this.journalLines++;
  }

  allowed(person: string, pageId: string, origin: string): boolean {
    return this.map().has(keyOf(person, pageId, origin));
  }

  /** How many sites a reader keeps for a page. */
  count(person: string, pageId: string): number {
    const me = person.toLowerCase();
    let total = 0;
    for (const row of this.map().values()) if (row.pageId === pageId && row.person.toLowerCase() === me) total++;
    return total;
  }

  /** Keep an approval; false when the store is full (nobody else's row is
   * ever dropped for it). */
  allow(person: string, pageId: string, origin: string): boolean {
    const map = this.map();
    const key = keyOf(person, pageId, origin);
    const me = person.toLowerCase();
    const mine = [...map.values()].filter((row) => row.person.toLowerCase() === me);
    const forget: Row[] = [];
    if (!map.has(key)) {
      // that reader's own oldest go: first on this page, then over every page
      const onPage = mine.filter((row) => row.pageId === pageId).sort((a, b) => a.at - b.at);
      forget.push(...onPage.slice(0, Math.max(0, onPage.length - PAGE_LINK_APPROVALS_PER_READER_PAGE + 1)));
      const rest = mine.filter((row) => !forget.includes(row)).sort((a, b) => a.at - b.at);
      forget.push(...rest.slice(0, Math.max(0, rest.length - PAGE_LINK_APPROVALS_PER_READER + 1)));
      if (map.size - forget.length >= PAGE_LINK_APPROVALS_MAX) return false;
    }
    for (const row of forget) {
      map.delete(keyOf(row.person, row.pageId, row.origin));
      this.write({ op: "forget", person: row.person, pageId: row.pageId, origin: row.origin });
    }
    // the newest answer is the newest row, even within the same millisecond
    const last = mine.reduce((max, row) => Math.max(max, row.at), 0);
    const at = Math.max(this.now(), last + 1);
    map.delete(key);
    map.set(key, { person, pageId, origin, at });
    this.write({ op: "allow", person, pageId, origin, at });
    return true;
  }

  forget(person: string, pageId: string, origin: string): void {
    if (this.map().delete(keyOf(person, pageId, origin))) this.write({ op: "forget", person, pageId, origin });
  }

  /** The page was revoked or deleted: every reader's approvals on it go. */
  forgetPage(pageId: string): void {
    const map = this.map();
    let changed = false;
    for (const [key, row] of map) {
      if (row.pageId === pageId) {
        map.delete(key);
        changed = true;
      }
    }
    if (changed) this.write({ op: "forgetPage", pageId });
  }
}
