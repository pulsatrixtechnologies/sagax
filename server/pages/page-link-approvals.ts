// "Always allow this site" on a page's link card (#3413): the reader's own
// answer, kept on disk per reader, page and host (the host exactly, as
// shared/page-capabilities.ts normalizePageLinkHost gives it: never a
// subdomain or another host). The person forgets one with DELETE; revoking
// the page forgets all of its approvals (forgetPage).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface Row {
  person: string;
  pageId: string;
  host: string;
  at: number;
}

const MAX_ROWS = 50_000;
const keyOf = (person: string, pageId: string, host: string) => `${person.toLowerCase()}\u0000${pageId}\u0000${host}`;

export class PageLinkApprovals {
  private rows: Map<string, Row> | null = null;
  private readonly file: string | null;
  private readonly now: () => number;

  /** `file`: where approvals are kept; null keeps them in memory (tests). */
  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
  }

  private map(): Map<string, Row> {
    if (this.rows) return this.rows;
    const map = new Map<string, Row>();
    if (this.file && existsSync(this.file)) {
      try {
        const rows = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
        if (Array.isArray(rows)) {
          for (const raw of rows) {
            const row = raw as Partial<Row>;
            if (typeof row.person === "string" && typeof row.pageId === "string" && typeof row.host === "string") {
              map.set(keyOf(row.person, row.pageId, row.host), { person: row.person, pageId: row.pageId, host: row.host, at: Number(row.at) || 0 });
            }
          }
        }
      } catch {
        // unreadable: nothing is allowed (fails closed)
      }
    }
    this.rows = map;
    return map;
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify([...this.map().values()], null, 1), { mode: 0o600 });
    renameSync(temp, this.file);
  }

  allowed(person: string, pageId: string, host: string): boolean {
    return this.map().has(keyOf(person, pageId, host));
  }

  allow(person: string, pageId: string, host: string): void {
    const map = this.map();
    if (!map.has(keyOf(person, pageId, host)) && map.size >= MAX_ROWS) map.delete(map.keys().next().value!);
    map.set(keyOf(person, pageId, host), { person, pageId, host, at: this.now() });
    this.save();
  }

  forget(person: string, pageId: string, host: string): void {
    if (this.map().delete(keyOf(person, pageId, host))) this.save();
  }

  /** The page was revoked: every reader's approvals on it go. */
  forgetPage(pageId: string): void {
    const map = this.map();
    let changed = false;
    for (const [key, row] of map) {
      if (row.pageId === pageId) {
        map.delete(key);
        changed = true;
      }
    }
    if (changed) this.save();
  }
}
