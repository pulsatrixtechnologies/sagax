// Published pages store (shared/published-pages.ts has the rules; routes in
// server/routes/published-pages.ts).
//
// A page is versioned: each propose_page call adds a `proposed` version, and
// only the person's Publish on its card (or in Pages publiées) makes a
// version the one readers get. Nothing a bot sends can publish, change who
// can see a page or extend its life.
//
// Whose page it is: the person the conversation belongs to (threadOwner in
// server/thread-privacy.ts: the thread's recorded owner, else the bot
// owner), never simply the bot's owner, so a member's private conversation
// with someone else's team bot gives the member the page.
//
// The reading link is `<linkId>.<mac>`: a random 128-bit id and an
// HMAC-SHA256 (192 bits kept) of it under a key that never leaves the server
// (published-pages.key, 0600). Revoking drops the link id: the old link then
// answers the same 404 as a made-up one, and publishing again mints a new
// link, so a revoked link never comes back. The wrapper mints a frame ticket
// (`<exp>.<mac>`, five minutes) for the page's own frame, so the frame needs
// no cookie and works from a separate pages origin.
//
// Storage: the index (published-pages.json, 0600, no content) is read once
// and again only when its modification time or size changes; each version's
// content is its own file (published-pages/<pageId>/<n>, 0600 in 0700
// folders) and is cached in memory once read (a version never changes).
// Caps: per person, per bot, per server, versions per page, total bytes.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { threadOwner } from "./thread-privacy.ts";
import {
  DEFAULT_PAGES_POLICY,
  PAGE_FRAME_TICKET_MS,
  PAGE_LIMITS,
  PAGE_VIEW_PREFIX,
  type PageAccess,
  type PageAnchor,
  type PageComment,
  type PageKind,
  type PageStatus,
  type PageVersionState,
  type PageVersionSummary,
  type PagesPolicy,
  type PublishedPageSummary,
  type ReaderComment,
} from "../shared/published-pages.ts";

const TOKEN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{32})$/;
const TICKET = /^(\d{10,16})\.([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{32})$/;
const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;
const CONTENT_CACHE_BYTES = 16 * 1024 * 1024;

/** The person a page proposed in this conversation belongs to. Pure. */
export function pageOwnerFor(task: { ownerPrincipalId?: string } | null | undefined, botOwnerPrincipalId: string): string {
  return threadOwner(task, botOwnerPrincipalId);
}

export interface PageVersionRecord {
  n: number;
  kind: PageKind;
  title: string;
  bytes: number;
  createdAt: number;
  state: PageVersionState;
  botId: string;
  /** "person": the page's person wrote this version (their edit). */
  author?: "person";
}

export interface PageHistoryEntry {
  at: number;
  action: "propose" | "publish" | "decline" | "access" | "expiry" | "revoke" | "rename" | "edit" | "reader-comments" | "reader-comment" | "reader-comment-approve" | "reader-comment-remove";
  version?: number;
  by?: string;
}

export interface PageRecord {
  id: string;
  /** Whose page it is: the conversation's person on an organization server;
   * absent on a one-person server (its owner). */
  ownerId?: string;
  botId: string;
  threadId: string;
  createdAt: number;
  updatedAt: number;
  status: PageStatus;
  access: PageAccess;
  expiresAt: number | null;
  currentVersion: number | null;
  /** The live reading link's id; absent while not published. */
  linkId?: string;
  versions: PageVersionRecord[];
  history: PageHistoryEntry[];
  /** The person's own name for the page (Rename); else the version's title. */
  title?: string;
  /** The person's review notes. Never served to readers. */
  comments?: PageComment[];
  /** The person lets readers comment (off unless they turn it on). */
  readerComments?: boolean;
  /** Readers' comments: pending until the person approves one. */
  readerNotes?: ReaderComment[];
}

export type PageError = { ok: false; status: 400 | 404 | 409; error: string; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameOwner(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

function refuse(status: 400 | 404 | 409, code: string, error: string): PageError {
  return { ok: false, status, error, code };
}

export class PublishedPages {
  private readonly file: string;
  private readonly contentDir: string;
  private readonly key: Buffer;
  private readonly clock: () => number;
  private cached: { mtimeMs: number; size: number; pages: PageRecord[]; policy: PagesPolicy } | null = null;
  private readonly contents = new Map<string, string>();
  private contentBytes = 0;
  /** Reader comment posts per source address, for the rate limit. */
  private readonly readerPosts = new Map<string, number[]>();

  constructor(dataDir: string, clock: () => number = Date.now) {
    this.clock = clock;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = join(dataDir, "published-pages.json");
    this.contentDir = join(dataDir, "published-pages");
    const keyFile = join(dataDir, "published-pages.key");
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
    this.key = readFileSync(keyFile);
  }

  private mac(purpose: string): string {
    return createHmac("sha256", this.key).update(purpose).digest("base64url").slice(0, 32);
  }

  token(linkId: string): string {
    return `${linkId}.${this.mac(`sagax-published-page:v1:${linkId}`)}`;
  }

  path(linkId: string): string {
    return `${PAGE_VIEW_PREFIX}${this.token(linkId)}`;
  }

  private verify(token: string): string | null {
    const match = TOKEN.exec(token);
    if (!match) return null;
    const expected = Buffer.from(this.mac(`sagax-published-page:v1:${match[1]!}`));
    const given = Buffer.from(match[2]!);
    return given.length === expected.length && timingSafeEqual(given, expected) ? match[1]! : null;
  }

  /** A five-minute ticket for a page frame: bound to its subject (a live
   * link, `link:<linkId>`, or a preview, `preview:<pageId>:<n>`) and to the
   * reader the wrapper served (`viewer`: anon, owner, member or p:<id>). */
  frameTicket(subject: string, viewer: string): string {
    const exp = this.clock() + PAGE_FRAME_TICKET_MS;
    const who = Buffer.from(viewer).toString("base64url");
    return `${exp}.${who}.${this.mac(`sagax-published-page-frame:v2:${subject}:${exp}:${viewer}`)}`;
  }

  /** The reader a valid ticket for this subject carries; null otherwise. */
  verifyFrameTicket(subject: string, ticket: string): string | null {
    const match = TICKET.exec(ticket);
    if (!match || !subject) return null;
    const exp = Number(match[1]);
    const now = this.clock();
    if (!Number.isSafeInteger(exp) || exp < now || exp > now + PAGE_FRAME_TICKET_MS) return null;
    const viewer = Buffer.from(match[2]!, "base64url").toString("utf8");
    const expected = Buffer.from(this.mac(`sagax-published-page-frame:v2:${subject}:${exp}:${viewer}`));
    const given = Buffer.from(match[3]!);
    return given.length === expected.length && timingSafeEqual(given, expected) ? viewer : null;
  }

  /** The index, read again only when the file changed. */
  private load(): PageRecord[] {
    let stat: { mtimeMs: number; size: number };
    try {
      stat = statSync(this.file);
    } catch {
      this.cached = null;
      return [];
    }
    if (this.cached && this.cached.mtimeMs === stat.mtimeMs && this.cached.size === stat.size) return this.cached.pages;
    let pages: PageRecord[] = [];
    let policy: PagesPolicy = { ...DEFAULT_PAGES_POLICY };
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { version?: unknown; pages?: unknown; policy?: unknown };
      if (raw.version === 2 && Array.isArray(raw.pages)) {
        pages = raw.pages.filter((page): page is PageRecord => isRecord(page) && typeof page.id === "string" && PAGE_ID.test(page.id) && Array.isArray(page.versions));
      }
      if (isRecord(raw.policy)) {
        policy = {
          linkSharing: typeof raw.policy.linkSharing === "boolean" ? raw.policy.linkSharing : DEFAULT_PAGES_POLICY.linkSharing,
          readerComments: typeof raw.policy.readerComments === "boolean" ? raw.policy.readerComments : DEFAULT_PAGES_POLICY.readerComments,
        };
      }
    } catch {
      pages = [];
    }
    this.cached = { mtimeMs: stat.mtimeMs, size: stat.size, pages, policy };
    return pages;
  }

  /** The organization's switch for public links (on by default). */
  policy(): PagesPolicy {
    this.load();
    return { ...(this.cached?.policy ?? DEFAULT_PAGES_POLICY) };
  }

  setPolicy(change: Partial<PagesPolicy>): PagesPolicy {
    const pages = this.snapshot();
    this.save(pages, { ...this.policy(), ...change });
    return this.policy();
  }

  /** Callers get copies: the cached index is never changed in place. */
  private snapshot(): PageRecord[] {
    return structuredClone(this.load());
  }

  private save(pages: PageRecord[], policy: PagesPolicy = this.policy()): void {
    // the default policy is not written: an index without one reads as on
    const kept = policy.linkSharing === DEFAULT_PAGES_POLICY.linkSharing && policy.readerComments === DEFAULT_PAGES_POLICY.readerComments ? {} : { policy };
    writeFileAtomic(this.file, JSON.stringify({ version: 2, pages, ...kept }, null, 2), { mode: 0o600 });
    this.cached = null;
  }

  private contentFile(pageId: string, n: number): string {
    return join(this.contentDir, pageId, String(n));
  }

  private writeContent(pageId: string, n: number, content: string): void {
    mkdirSync(join(this.contentDir, pageId), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.contentFile(pageId, n), content, { mode: 0o600 });
  }

  private dropContent(pageId: string, n?: number): void {
    if (n === undefined) {
      rmSync(join(this.contentDir, pageId), { recursive: true, force: true });
      for (const key of this.contents.keys()) if (key.startsWith(`${pageId}:`)) this.forget(key);
    } else {
      rmSync(this.contentFile(pageId, n), { force: true });
      this.forget(`${pageId}:${n}`);
    }
  }

  private forget(key: string): void {
    const text = this.contents.get(key);
    if (text === undefined) return;
    this.contentBytes -= text.length;
    this.contents.delete(key);
  }

  /** A version's content: from memory once read (a version never changes). */
  content(pageId: string, n: number): string | null {
    if (!PAGE_ID.test(pageId) || !Number.isSafeInteger(n)) return null;
    const key = `${pageId}:${n}`;
    const hit = this.contents.get(key);
    if (hit !== undefined) {
      this.contents.delete(key);
      this.contents.set(key, hit);
      return hit;
    }
    let text: string;
    try {
      text = readFileSync(this.contentFile(pageId, n), "utf8");
    } catch {
      return null;
    }
    this.contents.set(key, text);
    this.contentBytes += text.length;
    for (const [oldest, value] of this.contents) {
      if (this.contentBytes <= CONTENT_CACHE_BYTES) break;
      this.contentBytes -= value.length;
      this.contents.delete(oldest);
    }
    return text;
  }

  private mutate(id: string, change: (page: PageRecord, now: number) => PageRecord | PageError): PageRecord | PageError {
    const pages = this.snapshot();
    const page = pages.find((entry) => entry.id === id);
    if (!page) return refuse(404, "not_found", "This page does not exist.");
    const now = this.clock();
    const result = change(page, now);
    if ("ok" in result) return result;
    page.updatedAt = now;
    this.save(pages);
    return page;
  }

  get(id: string): PageRecord | null {
    const page = this.load().find((entry) => entry.id === id);
    return page ? structuredClone(page) : null;
  }

  /** The pages one person may manage: theirs, or every page (`ownerId`
   * undefined: the owner of a one-person server). */
  list(ownerId: string | undefined): PageRecord[] {
    return this.snapshot()
      .filter((page) => ownerId === undefined || sameOwner(page.ownerId, ownerId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** A bot's proposal: a new page, or a new version of one of this
   * conversation's pages. Never published here. */
  propose(input: { pageId?: string; ownerId?: string; botId: string; threadId: string; title: string; kind: PageKind; content: string; author?: "person"; by?: string }):
    { ok: true; page: PageRecord; version: PageVersionRecord } | PageError {
    const pages = this.snapshot();
    const now = this.clock();
    const bytes = Buffer.byteLength(input.content);
    if (bytes > PAGE_LIMITS.contentBytes) return refuse(400, "too_large", `content: at most ${PAGE_LIMITS.contentBytes / 1024} KB.`);
    let page = input.pageId ? pages.find((entry) => entry.id === input.pageId) : undefined;
    if (input.pageId && (!page || page.threadId !== input.threadId)) {
      return refuse(404, "not_found", "page_id: no page of this conversation has that id. Leave it out to propose a new page.");
    }
    const sizeOf = (entry: PageRecord) => entry.versions.reduce((inner, version) => inner + version.bytes, 0);
    const total = pages.reduce((sum, entry) => sum + sizeOf(entry), 0);
    if (total + bytes > PAGE_LIMITS.totalBytes) return refuse(409, "server_full", "Published pages are full on this server; the person must delete some first.");
    // The person's own share, for a new page and for a new version alike
    // (a new version counts against the page's person).
    const person = page ? page.ownerId : input.ownerId;
    const theirs = pages.filter((entry) => sameOwner(entry.ownerId, person)).reduce((sum, entry) => sum + sizeOf(entry), 0);
    if (theirs + bytes > PAGE_LIMITS.bytesPerOwner) return refuse(409, "owner_full", "This person's pages are full; they must delete some first.");
    if (!page) {
      if (pages.length >= PAGE_LIMITS.pages) return refuse(409, "too_many", `This server keeps at most ${PAGE_LIMITS.pages} pages; the person must delete one first.`);
      if (pages.filter((entry) => sameOwner(entry.ownerId, input.ownerId)).length >= PAGE_LIMITS.pagesPerOwner) {
        return refuse(409, "too_many_owner", `This person has ${PAGE_LIMITS.pagesPerOwner} pages; they must delete one first.`);
      }
      if (pages.filter((entry) => entry.botId === input.botId).length >= PAGE_LIMITS.pagesPerBot) {
        return refuse(409, "too_many_bot", `This bot already proposed ${PAGE_LIMITS.pagesPerBot} pages; the person must delete one first.`);
      }
      page = {
        id: randomBytes(12).toString("base64url"),
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        botId: input.botId,
        threadId: input.threadId,
        createdAt: now,
        updatedAt: now,
        status: "draft",
        access: "private",
        expiresAt: null,
        currentVersion: null,
        versions: [],
        history: [],
      };
      pages.push(page);
    }
    const n = (page.versions.at(-1)?.n ?? 0) + 1;
    const version: PageVersionRecord = { n, kind: input.kind, title: input.title, bytes, createdAt: now, state: "proposed", botId: input.botId, ...(input.author ? { author: input.author } : {}) };
    this.writeContent(page.id, n, input.content);
    page.versions.push(version);
    // Old versions that were never published go first; a published one stays.
    while (page.versions.length > PAGE_LIMITS.versions) {
      const drop = page.versions.findIndex((entry) => entry.n !== page!.currentVersion);
      if (drop < 0) break;
      const [gone] = page.versions.splice(drop, 1);
      this.dropContent(page.id, gone!.n);
    }
    page.history.push(input.author ? { at: now, action: "edit", version: n, ...(input.by ? { by: input.by } : {}) } : { at: now, action: "propose", version: n });
    page.updatedAt = now;
    this.save(pages);
    return { ok: true, page, version };
  }

  /** The person's own edit: a new version they wrote, stored as proposed
   * (it waits for their Publish like any other), under the same caps. */
  edit(id: string, input: { kind: PageKind; content: string; title?: string; by?: string }): { ok: true; page: PageRecord; version: PageVersionRecord } | PageError {
    const page = this.get(id);
    if (!page) return refuse(404, "not_found", "This page does not exist.");
    const last = page.versions.at(-1);
    return this.propose({
      pageId: page.id,
      ...(page.ownerId ? { ownerId: page.ownerId } : {}),
      botId: page.botId,
      threadId: page.threadId,
      title: input.title ?? last?.title ?? page.title ?? "",
      kind: input.kind,
      content: input.content,
      author: "person",
      ...(input.by ? { by: input.by } : {}),
    });
  }

  /** The person's name for the page, in any state. */
  rename(id: string, title: string, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      page.title = title;
      page.history.push({ at: now, action: "rename", ...(by ? { by } : {}) });
      return page;
    });
  }

  comments(id: string): PageComment[] {
    return this.get(id)?.comments ?? [];
  }

  addComment(id: string, input: { text: string; version?: number; anchor?: PageAnchor; by?: string }): { ok: true; comment: PageComment } | PageError {
    let made: PageComment | null = null;
    const result = this.mutate(id, (page, now) => {
      const comments = page.comments ?? [];
      if (comments.length >= PAGE_LIMITS.comments) return refuse(409, "too_many_comments", `A page keeps at most ${PAGE_LIMITS.comments} comments; delete some first.`);
      if (input.version !== undefined && !page.versions.some((entry) => entry.n === input.version)) return refuse(404, "no_version", "This version does not exist.");
      made = {
        id: randomBytes(9).toString("base64url"),
        at: now,
        text: input.text,
        ...(input.version !== undefined ? { version: input.version } : {}),
        ...(input.anchor ? { anchor: input.anchor } : {}),
        ...(input.by ? { by: input.by } : {}),
      };
      page.comments = [...comments, made];
      return page;
    });
    if ("ok" in result) return result;
    return { ok: true, comment: made! };
  }

  removeComment(id: string, commentId: string): PageRecord | PageError {
    return this.mutate(id, (page) => {
      const comments = page.comments ?? [];
      if (!comments.some((entry) => entry.id === commentId)) return refuse(404, "no_comment", "This comment does not exist.");
      page.comments = comments.filter((entry) => entry.id !== commentId);
      return page;
    });
  }

  /** The person's switch for reader comments on this page. */
  setReaderComments(id: string, on: boolean, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      if ((page.readerComments === true) !== on) {
        page.readerComments = on;
        page.history.push({ at: now, action: "reader-comments", ...(by ? { by } : {}) });
      }
      return page;
    });
  }

  readerComments(id: string): ReaderComment[] {
    return this.get(id)?.readerNotes ?? [];
  }

  /** The rate limit of reader comments: true (and counted) while this
   * address posted fewer than the limit in the window. */
  allowReaderPost(source: string): boolean {
    const now = this.clock();
    const since = now - PAGE_LIMITS.readerCommentWindowMs;
    const recent = (this.readerPosts.get(source) ?? []).filter((at) => at > since);
    if (recent.length >= PAGE_LIMITS.readerCommentsPerWindow) {
      this.readerPosts.set(source, recent);
      return false;
    }
    recent.push(now);
    this.readerPosts.set(source, recent);
    if (this.readerPosts.size > 10_000) {
      for (const [key, times] of this.readerPosts) if (!times.some((at) => at > since)) this.readerPosts.delete(key);
    }
    return true;
  }

  /** A reader's comment, held for the person's approval. */
  addReaderComment(id: string, input: { name: string; text: string; version?: number }): { ok: true; comment: ReaderComment } | PageError {
    let made: ReaderComment | null = null;
    const result = this.mutate(id, (page, now) => {
      const notes = page.readerNotes ?? [];
      if (notes.length >= PAGE_LIMITS.readerComments || notes.filter((entry) => entry.status === "pending").length >= PAGE_LIMITS.readerCommentsPending) {
        return refuse(409, "too_many_reader_comments", "This page takes no more comments for now.");
      }
      made = { id: randomBytes(9).toString("base64url"), at: now, name: input.name, text: input.text, status: "pending", ...(input.version !== undefined ? { version: input.version } : {}) };
      page.readerNotes = [...notes, made];
      page.history.push({ at: now, action: "reader-comment" });
      return page;
    });
    if ("ok" in result) return result;
    return { ok: true, comment: made! };
  }

  approveReaderComment(id: string, commentId: string, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const note = (page.readerNotes ?? []).find((entry) => entry.id === commentId);
      if (!note) return refuse(404, "no_comment", "This comment does not exist.");
      note.status = "approved";
      page.history.push({ at: now, action: "reader-comment-approve", ...(by ? { by } : {}) });
      return page;
    });
  }

  removeReaderComment(id: string, commentId: string, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const notes = page.readerNotes ?? [];
      if (!notes.some((entry) => entry.id === commentId)) return refuse(404, "no_comment", "This comment does not exist.");
      page.readerNotes = notes.filter((entry) => entry.id !== commentId);
      page.history.push({ at: now, action: "reader-comment-remove", ...(by ? { by } : {}) });
      return page;
    });
  }

  /** The person's Publish: make `version` the one readers get, with who can
   * see it and until when. Mints a reading link when there is none. */
  publish(id: string, input: { version: number; access: PageAccess; expiresAt: number | null; by?: string }): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const version = page.versions.find((entry) => entry.n === input.version);
      if (!version) return refuse(404, "no_version", "This version does not exist.");
      if (version.state === "declined") return refuse(409, "declined", "This version was declined.");
      for (const entry of page.versions) if (entry.state === "published" && entry.n !== version.n) entry.state = "proposed";
      version.state = "published";
      page.currentVersion = version.n;
      page.status = "published";
      page.access = input.access;
      page.expiresAt = input.expiresAt;
      page.linkId ??= randomBytes(16).toString("base64url");
      page.history.push({ at: now, action: "publish", version: version.n, ...(input.by ? { by: input.by } : {}) });
      return page;
    });
  }

  /** The person's Decline on a proposal: it can never be published. */
  decline(id: string, versionNumber: number, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const version = page.versions.find((entry) => entry.n === versionNumber);
      if (!version) return refuse(404, "no_version", "This version does not exist.");
      if (version.state === "published") return refuse(409, "published", "This version is the published one; revoke the page instead.");
      version.state = "declined";
      page.history.push({ at: now, action: "decline", version: versionNumber, ...(by ? { by } : {}) });
      return page;
    });
  }

  /** Change who can see a published page, or its expiry. */
  update(id: string, input: { access?: PageAccess; expiresAt?: number | null; by?: string }): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      if (page.status !== "published") return refuse(409, "not_published", "Publish this page first.");
      if (input.access !== undefined && input.access !== page.access) {
        page.access = input.access;
        page.history.push({ at: now, action: "access", ...(input.by ? { by: input.by } : {}) });
      }
      if (input.expiresAt !== undefined && input.expiresAt !== page.expiresAt) {
        page.expiresAt = input.expiresAt;
        page.history.push({ at: now, action: "expiry", ...(input.by ? { by: input.by } : {}) });
      }
      return page;
    });
  }

  /** Stop serving the page now. The link is gone for good. */
  revoke(id: string, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      page.status = "revoked";
      delete page.linkId;
      page.currentVersion = null;
      for (const entry of page.versions) if (entry.state === "published") entry.state = "proposed";
      page.history.push({ at: now, action: "revoke", ...(by ? { by } : {}) });
      return page;
    });
  }

  remove(id: string): boolean {
    const pages = this.snapshot();
    const kept = pages.filter((page) => page.id !== id);
    if (kept.length === pages.length) return false;
    this.save(kept);
    this.dropContent(id);
    return true;
  }

  /** The page and version a reading token opens, or null: bad signature,
   * revoked, never published, or past its expiry. */
  open(token: string): { page: PageRecord; version: PageVersionRecord } | null {
    const linkId = this.verify(token);
    if (!linkId) return null;
    const page = this.load().find((entry) => entry.linkId === linkId);
    if (!page || page.status !== "published" || page.currentVersion === null) return null;
    if (page.expiresAt !== null && page.expiresAt <= this.clock()) return null;
    const version = page.versions.find((entry) => entry.n === page.currentVersion);
    return version ? { page: structuredClone(page), version: { ...version } } : null;
  }

  summary(page: PageRecord, origin: string, reachable: boolean): PublishedPageSummary {
    const versions: PageVersionSummary[] = page.versions.map((entry) => ({
      n: entry.n,
      kind: entry.kind,
      title: entry.title,
      createdAt: entry.createdAt,
      state: entry.state,
      bytes: entry.bytes,
      botId: entry.botId,
      ...(entry.author ? { author: entry.author } : {}),
    }));
    const current = page.versions.find((entry) => entry.n === page.currentVersion) ?? page.versions.at(-1);
    const live = page.status === "published" && page.linkId;
    const path = live ? this.path(page.linkId!) : undefined;
    return {
      id: page.id,
      title: page.title ?? current?.title ?? "",
      status: page.status,
      access: page.access,
      expiresAt: page.expiresAt,
      currentVersion: page.currentVersion,
      botId: page.botId,
      threadId: page.threadId,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      expired: page.expiresAt !== null && page.expiresAt <= this.clock(),
      versions,
      ...(page.comments?.length ? { comments: page.comments.length } : {}),
      ...(page.readerComments ? { readerComments: true } : {}),
      ...((page.readerNotes ?? []).some((entry) => entry.status === "pending") ? { pendingReaderComments: page.readerNotes!.filter((entry) => entry.status === "pending").length } : {}),
      ...(path ? { path, url: `${origin.replace(/\/+$/, "")}${path}`, reachable } : {}),
    };
  }
}
