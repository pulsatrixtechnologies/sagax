// A page's store (#3413 lot 3, shared/page-capabilities.ts): the collections
// of documents its script keeps through `sagax.store`, durable, apart from
// the page's small shared state.
//
// Whose documents: a `shared` collection is one set every reader of the page
// reads; a `reader` collection keeps each reader's documents under that
// reader and gives them to nobody else (the page's person included), so
// reader B never reads what reader A wrote there.
//
// The scope is kept with each document, not taken from the version being
// read: a later (or unpublished) version that declares the same collection
// `shared` never reaches a document written in reader scope, which stays
// its writer's alone. A shared list, get, write or delete only ever touches
// shared documents; a reader one only the reader's own.
//
// Storage: one file per page (page-store/<pageId>.json, 0600 in a 0700
// folder), read once and kept in memory. Limits (PAGE_CAP_LIMITS):
// documents per collection, bytes per document, bytes per page. The bytes
// also count in the page person's own share (PublishedPages.ownerBytes).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { PAGE_CAP_LIMITS, PAGE_STORE_DOC_ID, PAGE_STORE_LIST_MAX, type PageStoreQuery, type PageStoreScope } from "../../shared/page-capabilities.ts";

export interface StoredDoc {
  id: string;
  value: unknown;
  /** The writer: a principal id, or "owner" on a one-person server. */
  by: string;
  at: number;
  /** The scope it was written in; it decides who reads it, whatever a later
   * version declares. Absent on a document kept before it was stored: the
   * key tells (a reader key holds the writer). */
  scope?: PageStoreScope;
}

type Collections = Record<string, Record<string, StoredDoc>>;

export type PageStoreError = { ok: false; status: 400 | 404 | 409 | 413; code: "bad_request" | "not_found" | "too_large"; error: string };

const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;

/** A reader collection keeps each reader's document under its own key. */
function keyOf(scope: PageStoreScope, by: string, id: string): string {
  return scope === "reader" ? `${by.toLowerCase()}\u0000${id}` : id;
}

/** The scope a stored document was written in. */
function scopeOf(key: string, doc: StoredDoc): PageStoreScope {
  return doc.scope ?? (key.includes("\u0000") ? "reader" : "shared");
}

/** Whether a reader asking in `scope` sees this stored document: only a
 * document written in that same scope, and a reader one only by its writer. */
function mine(scope: PageStoreScope, key: string, doc: StoredDoc, reader: string): boolean {
  const kept = scopeOf(key, doc);
  if (kept !== scope) return false;
  return kept !== "reader" || doc.by.toLowerCase() === reader.toLowerCase();
}

/** A document as handed out: without its stored scope. */
function copy(doc: StoredDoc): StoredDoc {
  return { id: doc.id, value: doc.value, by: doc.by, at: doc.at };
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function field(value: unknown, name: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[name] : undefined;
}

export class PageStore {
  private readonly cache = new Map<string, Collections>();
  private readonly dir: string | null;
  private readonly now: () => number;

  /** `dir`: where the pages' files live; null keeps everything in memory (tests). */
  constructor(dir: string | null, now: () => number = Date.now) {
    this.dir = dir;
    this.now = now;
  }

  private file(pageId: string): string | null {
    return this.dir && PAGE_ID.test(pageId) ? join(this.dir, `${pageId}.json`) : null;
  }

  private load(pageId: string): Collections {
    const cached = this.cache.get(pageId);
    if (cached) return cached;
    let data: Collections = {};
    const file = this.file(pageId);
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Collections;
      } catch {
        // unreadable: the page starts empty rather than failing every call
      }
    }
    this.cache.set(pageId, data);
    return data;
  }

  private save(pageId: string, data: Collections): void {
    this.cache.set(pageId, data);
    const file = this.file(pageId);
    if (!file || !this.dir) return;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(file, JSON.stringify(data), { mode: 0o600 });
  }

  /** What the page's store holds, in bytes (its file). */
  bytes(pageId: string): number {
    const data = this.cache.get(pageId) ?? this.load(pageId);
    return Object.keys(data).length ? Buffer.byteLength(JSON.stringify(data)) : 0;
  }

  /** The documents this reader sees in one collection, filtered, sorted, capped. */
  list(pageId: string, collection: string, input: { scope: PageStoreScope; reader: string; query?: PageStoreQuery }): StoredDoc[] {
    const docs = Object.entries(this.load(pageId)[collection] ?? {}).filter(([key, doc]) => mine(input.scope, key, doc, input.reader)).map(([, doc]) => doc);
    const where = Object.entries(input.query?.where ?? {});
    const kept = where.length ? docs.filter((doc) => where.every(([name, wanted]) => field(doc.value, name) === wanted)) : docs;
    const order = input.query?.order;
    kept.sort(order && order.by !== "at"
      ? (a, b) => compare(field(a.value, order.by), field(b.value, order.by)) * (order.desc ? -1 : 1)
      : (a, b) => (a.at - b.at) * (order?.desc ? -1 : 1));
    return kept.slice(0, Math.min(input.query?.limit ?? PAGE_STORE_LIST_MAX, PAGE_STORE_LIST_MAX)).map(copy);
  }

  /** One document this reader sees, or null. */
  get(pageId: string, collection: string, id: string, input: { scope: PageStoreScope; reader: string }): StoredDoc | null {
    const key = keyOf(input.scope, input.reader, id);
    const doc = this.load(pageId)[collection]?.[key];
    return doc && mine(input.scope, key, doc, input.reader) ? copy(doc) : null;
  }

  /** Write one document (a new id when `id` is absent), within the limits;
   * `room` is how many bytes the page's person still has. */
  put(pageId: string, collection: string, input: { scope: PageStoreScope; by: string; id?: string; value: unknown; room?: number }): { ok: true; doc: StoredDoc; grew: number } | PageStoreError {
    if (input.id !== undefined && !PAGE_STORE_DOC_ID.test(input.id)) return { ok: false, status: 400, code: "bad_request", error: "A document id is 1 to 64 letters, digits, _ or -." };
    if (input.value === undefined) return { ok: false, status: 400, code: "bad_request", error: "A document needs a value." };
    let json: string;
    try {
      json = JSON.stringify(input.value);
    } catch {
      return { ok: false, status: 400, code: "bad_request", error: "A document is plain JSON data." };
    }
    if (Buffer.byteLength(json) > PAGE_CAP_LIMITS.storeDocumentBytes) return { ok: false, status: 413, code: "too_large", error: `A document is at most ${PAGE_CAP_LIMITS.storeDocumentBytes / 1024} KB.` };
    const before = this.bytes(pageId);
    const data = structuredClone(this.load(pageId));
    const docs = data[collection] ?? {};
    const id = input.id ?? randomBytes(12).toString("base64url");
    const key = keyOf(input.scope, input.by, id);
    // a reader key holds its writer and an id never does, so a shared write
    // never lands on a reader's document, nor the reverse
    if (!(key in docs) && Object.keys(docs).length >= PAGE_CAP_LIMITS.storeDocuments) return { ok: false, status: 409, code: "too_large", error: `A collection keeps at most ${PAGE_CAP_LIMITS.storeDocuments} documents.` };
    const doc: StoredDoc = { id, value: JSON.parse(json), by: input.by, at: this.now(), scope: input.scope };
    docs[key] = doc;
    data[collection] = docs;
    const after = Buffer.byteLength(JSON.stringify(data));
    if (after > PAGE_CAP_LIMITS.storePageBytes) return { ok: false, status: 409, code: "too_large", error: `A page's store keeps at most ${PAGE_CAP_LIMITS.storePageBytes / 1024 / 1024} MB.` };
    const grew = after - before;
    if (input.room !== undefined && grew > 0 && grew > input.room) return { ok: false, status: 409, code: "too_large", error: "The page's person has no room left for their pages." };
    this.save(pageId, data);
    return { ok: true, doc: copy(doc), grew };
  }

  /** Remove one document this reader sees; false when there is none. */
  delete(pageId: string, collection: string, id: string, input: { scope: PageStoreScope; reader: string }): boolean {
    const data = structuredClone(this.load(pageId));
    const key = keyOf(input.scope, input.reader, id);
    const doc = data[collection]?.[key];
    if (!doc || !mine(input.scope, key, doc, input.reader)) return false;
    delete data[collection]![key];
    if (!Object.keys(data[collection]!).length) delete data[collection];
    this.save(pageId, data);
    return true;
  }

  /** The page is revoked or deleted: its store goes. */
  forget(pageId: string): void {
    this.cache.delete(pageId);
    const file = this.file(pageId);
    if (file) rmSync(file, { force: true });
  }
}
