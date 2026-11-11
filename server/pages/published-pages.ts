// Published pages store (shared/published-pages.ts has the rules; routes in
// server/routes/published-pages.ts).
//
// A page is versioned: each propose_page call adds a `proposed` version, and
// only the person's Publish on its card (or in Pages publiées) makes a
// version the one readers get. Nothing a bot sends can publish a draft,
// change who can see a page, change its audience or extend its life. When
// the person has allowed the bot to keep a published page up to date, a
// new version becomes the one readers get, with the same access, audience
// and expiry.
//
// Whose page it is: the person the conversation belongs to (threadOwner in
// server/threads/thread-privacy.ts: the thread's recorded owner, else the bot
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
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { sanitizePageLook, type PageLook } from "../../src/lib/page-look.ts";
import { applyDesignSystem, BUILTIN_DESIGN_SYSTEMS, DEFAULT_DESIGN_SYSTEM, DESIGN_SYSTEM_LIMITS, findDesignSystem, ownDesignSystemId, parseDesignTokens, type DesignSystem } from "../../src/lib/design-systems.ts";
import { threadOwner } from "../threads/thread-privacy.ts";
import { utf8Slice } from "../../shared/utf8-slice.ts";
import { pageAudienceOf, samePageAudience, type PageAudience } from "../../shared/page-audience.ts";
import { pageCapabilitiesOf, pageCapabilitiesPersonal, type PageCapabilities } from "../../shared/page-capabilities.ts";
import { ANON_STATE_LIMITS, anonymousBy, STATE_LIMITS, stateRulesOf, stateValueJson, type PageStateEntry, type StateRules } from "../../shared/page-state.ts";
import { THREAD_LIMITS, type PageQuote, type PageSuggestion, type PageThread, type PageThreadReply } from "../../shared/page-threads.ts";
import {
  DEFAULT_PAGES_POLICY,
  PAGE_FRAME_TICKET_MS,
  PAGE_LIMITS,
  pageIsHtml,
  PAGE_VIEW_PREFIX,
  type PageAccess,
  type PageAnchor,
  type PageComment,
  type PageInvites,
  type PageKind,
  type PageStatus,
  type PageVersionState,
  type PageVersionSummary,
  type PagesPolicy,
  type PublishedPageSummary,
  type ReaderComment,
} from "../../shared/published-pages.ts";

const TOKEN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{32})$/;
const TICKET = /^(\d{10,16})\.([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{32})$/;
const PAGE_ID = /^[A-Za-z0-9_-]{8,40}$/;
const CONTENT_CACHE_BYTES = 16 * 1024 * 1024;

/** #3488: the size in bytes and the SHA-256 (hex) of a stored source, the
 * one place both are computed (a proposal's answer, the version listing,
 * a read of the source). Pure. */
export interface PageSourceDigest { bytes: number; sha256: string }

/** #3488: why a stored source differs from what the bot gave (its file or
 * its text): secret-shaped text masked, a design system applied. */
export type PageSourceChange = "secret_masked" | "design_system_applied";

export function pageSourceDigest(content: string): PageSourceDigest {
  const buffer = Buffer.from(content, "utf8");
  return { bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
}

/** Default and ceiling of one paged read of a source, in bytes. */
export const PAGE_SOURCE_READ_BYTES = { default: 32_000, max: 64_000 } as const;

/** #3488: one slice of a source by UTF-8 byte offset (utf8Slice: never
 * cuts a character). Following nextOffset gives slices that concatenate to
 * the source exactly. Pure. */
export function pageSourceSlice(content: string, offset: number, limit: number): { text: string; offset: number; nextOffset: number | null } {
  const buffer = Buffer.from(content, "utf8");
  const slice = utf8Slice(buffer, offset, limit);
  return { text: buffer.subarray(slice.start, slice.end).toString("utf8"), offset: slice.start, nextOffset: slice.end < buffer.length ? slice.end : null };
}

/** #3488: the offset and limit of a paged source read (query text or
 * numbers), "whole" when neither is given, null when either is invalid. */
export function pageSourceRange(offset: unknown, limit: unknown): { offset?: number; limit?: number } | "whole" | null {
  const given = (value: unknown) => value !== undefined && value !== null && value !== "";
  if (!given(offset) && !given(limit)) return "whole";
  const number = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  const at = given(offset) ? number(offset) : 0;
  const size = given(limit) ? number(limit) : PAGE_SOURCE_READ_BYTES.default;
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(size) || size < 1 || size > PAGE_SOURCE_READ_BYTES.max) return null;
  return { offset: at, limit: size };
}

/** What a read of one version's source answers (the person's editor route
 * and the bot's page_comments action source). */
export interface PageSourceRead {
  version: { n: number; kind: PageKind; title: string; bytes: number; sha256: string };
  content: string;
  offset: number;
  nextOffset: number | null;
}

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
  /** #3488: SHA-256 (hex) of the stored source. Absent on a version stored
   * before it was recorded until its first source read (recordDigest). */
  sha256?: string;
}

export interface PageHistoryEntry {
  at: number;
  action: "propose" | "publish" | "decline" | "access" | "expiry" | "revoke" | "rename" | "edit" | "reader-comments" | "reader-comment" | "reader-comment-approve" | "reader-comment-remove" | "audience" | "pin" | "live" | "keep" | "invite" | "editors" | "bot-share";
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
  /** Who may see this page inside Sagax. Absent means the person only. */
  audience?: PageAudience;
  /** The person's pin in their page list. */
  pinned?: boolean;
  /** The person allows the bot (and their own later edit) to replace the
   * published version. Never set by the bot. Off unless they turn it on. */
  keepUpdated?: boolean;
  /** #3413: a version that declares a personal data capability was current
   * at some point. Never removed, revoke included (versions are trimmed, so
   * their contents cannot tell it later, and a reader's frame may outlive a
   * revoke): while it is set and the page is shared with anyone but its
   * person, its shared state is read only. */
  personalData?: true;
  /** #3128: the person shares this page in the bot's Library. Everyone who
   * may use the bot reads it and asks the bot to refresh it. Absent means
   * personal, the default. */
  botShared?: boolean;
  /** The people and teams the person invited to read it (Share). */
  invites?: PageInvites;
  /** People who may edit this page besides its person (#1704). */
  editors?: string[];
  /** Annotations of the people who read it (2026-10-28): threads anchored
   * on the page, with replies; seen by everyone who may read it. */
  threads?: PageThread[];
  /** When the page's bot last read its annotations (page context or
   * page_comments): what came after is new to it. */
  botReadAt?: number;
  /** The page's shared state (#1544, shared/page-state.ts): what its
   * script set through window.sagax.page, by key. Erased on revoke. */
  state?: Record<string, PageStateEntry>;
  /** Keys its person made read-only (2026-10-29): nobody writes them. */
  stateLocks?: string[];
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
  /** Shared-state writes per page and person, for the rate limit. */
  private readonly stateWrites = new Map<string, number[]>();
  /** Writes of readers not signed in, per page and network address. */
  private readonly anonSourceWrites = new Map<string, number[]>();
  /** Reader comment posts per source address, for the rate limit. */
  private readonly readerPosts = new Map<string, number[]>();
  /** Each person's look (src/lib/page-look.ts), kept apart from the index. */
  private readonly looksFile: string;
  private looksCache: Record<string, PageLook> | null = null;
  /** Each person's own design systems (#2717), kept apart like the looks. */
  private readonly designSystemsFile: string;
  private indexUnreadable = false;
  private looksUnreadable = false;

  constructor(dataDir: string, clock: () => number = Date.now) {
    this.clock = clock;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = join(dataDir, "published-pages.json");
    this.contentDir = join(dataDir, "published-pages");
    this.looksFile = join(dataDir, "published-pages-looks.json");
    this.designSystemsFile = join(dataDir, "published-pages-design-systems.json");
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.refuseUnreadable("index");
      this.indexUnreadable = false;
      this.cached = null;
      return [];
    }
    if (this.cached && this.cached.mtimeMs === stat.mtimeMs && this.cached.size === stat.size) return this.cached.pages;
    let pages: PageRecord[] = [];
    let policy: PagesPolicy = { ...DEFAULT_PAGES_POLICY };
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (!isRecord(raw) || raw.version !== 2 || !Array.isArray(raw.pages)) throw new Error("invalid index");
      pages = raw.pages.filter((page): page is PageRecord => isRecord(page) && typeof page.id === "string" && PAGE_ID.test(page.id) && Array.isArray(page.versions));
      if (pages.length !== raw.pages.length || (raw.policy !== undefined && !isRecord(raw.policy))) throw new Error("invalid index");
      if (isRecord(raw.policy)) {
        policy = {
          linkSharing: typeof raw.policy.linkSharing === "boolean" ? raw.policy.linkSharing : DEFAULT_PAGES_POLICY.linkSharing,
          readerComments: typeof raw.policy.readerComments === "boolean" ? raw.policy.readerComments : DEFAULT_PAGES_POLICY.readerComments,
        };
      }
    } catch {
      this.refuseUnreadable("index");
    }
    this.indexUnreadable = false;
    this.cached = { mtimeMs: stat.mtimeMs, size: stat.size, pages, policy };
    return pages;
  }

  private looks(): Record<string, PageLook> {
    if (this.looksCache) return this.looksCache;
    const out: Record<string, PageLook> = {};
    try {
      const raw = JSON.parse(readFileSync(this.looksFile, "utf8")) as unknown;
      if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.looks)) throw new Error("invalid looks");
      for (const [key, value] of Object.entries(raw.looks)) {
        const look = sanitizePageLook(value);
        if (!look) throw new Error("invalid look");
        out[key] = look;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.refuseUnreadable("looks");
    }
    this.looksUnreadable = false;
    this.looksCache = out;
    return out;
  }

  /** Never turn an unreadable registry into an empty one. Keep failures
   * uncached so repairing the file lets the next request read it again. */
  private refuseUnreadable(kind: "index" | "looks"): never {
    const file = kind === "index" ? "published-pages.json" : "published-pages-looks.json";
    const reported = kind === "index" ? this.indexUnreadable : this.looksUnreadable;
    if (!reported) console.error(`published-pages: unreadable ${file}; keeping the file unchanged until it is repaired.`);
    if (kind === "index") this.indexUnreadable = true;
    else this.looksUnreadable = true;
    throw Object.assign(new Error(`Saved published pages could not be read. Repair ${file} before using them.`), { status: 503 });
  }

  /** A person's look, as their app last sent it (2026-10-29): what a
   * reading link of their pages is drawn in. `owner` is the page's ownerId,
   * "" for a one-person server's owner. */
  look(owner: string | undefined): PageLook | null {
    return this.looks()[(owner ?? "").toLowerCase()] ?? null;
  }

  /** Keep a person's look (checked again here); written only when it
   * changed. Null when there is nothing usable in it. */
  setLook(owner: string | undefined, value: unknown): PageLook | null {
    const look = sanitizePageLook(value);
    if (!look) return null;
    const key = (owner ?? "").toLowerCase();
    const all = { ...this.looks() };
    if (JSON.stringify(all[key] ?? null) === JSON.stringify(look)) return look;
    all[key] = look;
    writeFileAtomic(this.looksFile, JSON.stringify({ version: 1, looks: all }), { mode: 0o600 });
    this.looksCache = all;
    return look;
  }

  /** A person's own design systems (#2717), newest first. An unreadable
   * file reads as none: they are rebuilt by the bot from the person's code. */
  ownDesignSystems(owner: string | undefined): DesignSystem[] {
    return this.allDesignSystems()[(owner ?? "").toLowerCase()] ?? [];
  }

  /** The built-in systems, then the person's own. */
  designSystems(owner: string | undefined): DesignSystem[] {
    return [...BUILTIN_DESIGN_SYSTEMS, ...this.ownDesignSystems(owner)];
  }

  /** Keep a person's own system (taken from their code): same name, same
   * id, replaced. Null when no token is usable. */
  saveDesignSystem(owner: string | undefined, name: string, tokens: unknown): DesignSystem | null {
    const clean = parseDesignTokens(tokens);
    const label = name.replace(/\s+/g, " ").trim().slice(0, DESIGN_SYSTEM_LIMITS.name);
    if (!clean || !label) return null;
    const system: DesignSystem = { id: ownDesignSystemId(label), name: label, tokens: clean };
    const key = (owner ?? "").toLowerCase();
    const all = { ...this.allDesignSystems() };
    all[key] = [system, ...(all[key] ?? []).filter((entry) => entry.id !== system.id)].slice(0, DESIGN_SYSTEM_LIMITS.systemsPerOwner);
    writeFileAtomic(this.designSystemsFile, JSON.stringify({ version: 1, systems: all }), { mode: 0o600 });
    return system;
  }

  /** Forget one of the person's own systems. */
  deleteDesignSystem(owner: string | undefined, id: string): boolean {
    const key = (owner ?? "").toLowerCase();
    const all = { ...this.allDesignSystems() };
    const before = all[key] ?? [];
    const after = before.filter((entry) => entry.id !== id);
    if (after.length === before.length) return false;
    all[key] = after;
    writeFileAtomic(this.designSystemsFile, JSON.stringify({ version: 1, systems: all }), { mode: 0o600 });
    return true;
  }

  private allDesignSystems(): Record<string, DesignSystem[]> {
    try {
      const raw = JSON.parse(readFileSync(this.designSystemsFile, "utf8")) as unknown;
      if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.systems)) return {};
      const out: Record<string, DesignSystem[]> = {};
      for (const [key, list] of Object.entries(raw.systems)) {
        if (!Array.isArray(list)) continue;
        out[key] = list.flatMap((entry) => {
          if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") return [];
          const tokens = parseDesignTokens(entry.tokens);
          return tokens ? [{ id: entry.id, name: entry.name, tokens }] : [];
        });
      }
      return out;
    } catch {
      return {};
    }
  }

  /** A design's content with its system: the one named, else the person's
   * tokens saved under that name (or "My design system"), else the one it
   * already carries, else Sagax. */
  private designContent(owner: string | undefined, content: string, designSystem?: string, designTokens?: unknown): { ok: true; content: string } | PageError {
    let system: DesignSystem | undefined;
    if (designTokens !== undefined) {
      system = this.saveDesignSystem(owner, designSystem ?? "My design system", designTokens) ?? undefined;
      if (!system) return refuse(400, "bad_tokens", "design_tokens: no usable CSS custom property (--name: value) was found.");
    } else if (designSystem) {
      system = findDesignSystem(this.designSystems(owner), designSystem);
      if (!system) {
        const known = this.designSystems(owner).map((entry) => entry.id).join(", ");
        return refuse(400, "unknown_design_system", `design_system: unknown. Known: ${known}. Send design_tokens to add one from the person's code.`);
      }
    } else if (/data-sagax-design-system=/i.test(content)) {
      return { ok: true, content };
    } else {
      system = findDesignSystem(BUILTIN_DESIGN_SYSTEMS, DEFAULT_DESIGN_SYSTEM)!;
    }
    return { ok: true, content: applyDesignSystem(content, system) };
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

  /** #3488: one version's stored source with its size and hash: whole, or
   * one slice by byte offset and limit (pageSourceSlice). Null: no such
   * version. Who may read it is the caller's check. */
  source(pageId: string, n: number, range?: { offset?: number; limit?: number }): PageSourceRead | null {
    if (!PAGE_ID.test(pageId) || !Number.isSafeInteger(n)) return null;
    const version = this.get(pageId)?.versions.find((entry) => entry.n === n);
    if (!version) return null;
    // the person's editor and the bot read a version rarely: straight from
    // its file, never through the cache that serves published pages
    let content: string;
    try {
      content = readFileSync(this.contentFile(pageId, n), "utf8");
    } catch {
      return null;
    }
    const digest = pageSourceDigest(content);
    // a version stored before its hash was recorded: kept on it from now on
    if (!version.sha256) this.recordDigest(pageId, n, digest);
    const head = { n: version.n, kind: version.kind, title: version.title, bytes: digest.bytes, sha256: digest.sha256 };
    if (!range || (range.offset === undefined && range.limit === undefined)) return { version: head, content, offset: 0, nextOffset: null };
    const slice = pageSourceSlice(content, range.offset ?? 0, range.limit ?? PAGE_SOURCE_READ_BYTES.default);
    return { version: head, content: slice.text, offset: slice.offset, nextOffset: slice.nextOffset };
  }

  /** #3488: keep the size and SHA-256 of a version stored before they were
   * recorded, once, on its first source read (never in a listing). */
  private recordDigest(pageId: string, n: number, digest: PageSourceDigest): void {
    const pages = this.snapshot();
    const version = pages.find((entry) => entry.id === pageId)?.versions.find((entry) => entry.n === n);
    if (!version || version.sha256) return;
    version.bytes = digest.bytes;
    version.sha256 = digest.sha256;
    this.save(pages);
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

  private mutate(id: string, change: (page: PageRecord, now: number) => PageRecord | PageError, touch = true): PageRecord | PageError {
    const pages = this.snapshot();
    const page = pages.find((entry) => entry.id === id);
    if (!page) return refuse(404, "not_found", "This page does not exist.");
    const now = this.clock();
    const sharedBefore = pageSharedWithOthers(page);
    const currentBefore = page.currentVersion;
    const result = change(page, now);
    if ("ok" in result) return result;
    // the version that stops being current counts too: a page stored before
    // the mark existed gets it as its data version goes
    if (page.currentVersion !== currentBefore) this.notePersonalData(page, [currentBefore, page.currentVersion]);
    // #3413: a page that reads personal data and becomes shared loses the
    // shared state it kept while private, so nothing it received goes out
    if (!sharedBefore && pageSharedWithOthers(page) && page.state && (page.personalData === true || this.declaresPersonalData(page))) delete page.state;
    if (touch) page.updatedAt = now;
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
      .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || b.updatedAt - a.updatedAt);
  }

  /** A bot's proposal: a new page, or a new version of one of this
   * conversation's pages (or of this bot's page for the same person). Never
   * published here. */
  propose(input: { pageId?: string; ownerId?: string; botId: string; threadId: string; title: string; kind: PageKind; content: string; author?: "person"; by?: string; designSystem?: string; designTokens?: unknown }):
    { ok: true; page: PageRecord; version: PageVersionRecord } | PageError {
    if (input.kind === "design" && !input.author) {
      const owner = input.pageId ? this.get(input.pageId)?.ownerId ?? input.ownerId : input.ownerId;
      const designed = this.designContent(owner, input.content, input.designSystem, input.designTokens);
      if (!designed.ok) return designed;
      input = { ...input, content: designed.content };
    }
    const pages = this.snapshot();
    const now = this.clock();
    const { bytes, sha256 } = pageSourceDigest(input.content);
    if (bytes > PAGE_LIMITS.contentBytes) return refuse(400, "too_large", `content: at most ${PAGE_LIMITS.contentBytes / 1024} KB.`);
    let page = input.pageId ? pages.find((entry) => entry.id === input.pageId) : undefined;
    // A page of this conversation, or (2026-10-28, the page view) one of this
    // bot's pages for the same person, opened from another topic. Never
    // another bot's page, never another person's.
    // #3128: a page shared in the bot's Library is also refreshed by whoever
    // uses that bot (the same bot, never another).
    const sharedRefresh = Boolean(page && page.botShared === true && page.botId === input.botId);
    if (input.pageId && (!page || (page.threadId !== input.threadId && !sharedRefresh && (page.botId !== input.botId || !sameOwner(page.ownerId, input.ownerId))))) {
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
        audience: { kind: "person" },
        pinned: false,
        keepUpdated: false,
      };
      pages.push(page);
    }
    const n = (page.versions.at(-1)?.n ?? 0) + 1;
    const version: PageVersionRecord = { n, kind: input.kind, title: input.title, bytes, sha256, createdAt: now, state: "proposed", botId: input.botId, ...(input.author ? { author: input.author } : {}) };
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
    // The person already published this page and allowed it to stay current.
    // The new version replaces the published one. Access, audience, expiry
    // and the link stay as the person left them.
    if (page.keepUpdated === true && page.status === "published" && page.currentVersion !== null) {
      for (const entry of page.versions) if (entry.state === "published" && entry.n !== version.n) entry.state = "proposed";
      version.state = "published";
      const outgoing = page.currentVersion;
      page.currentVersion = version.n;
      page.history.push({ at: now, action: "keep", version: n });
      this.notePersonalData(page, [outgoing, version.n]);
    }
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

  // ── annotations (2026-10-28): who may write them is the route's check ──

  threads(id: string): PageThread[] {
    return this.get(id)?.threads ?? [];
  }

  /** A new annotation on the version readers get. A comment never moves the
   * page in its person's list. */
  addThread(id: string, input: { by: string; anchor: PageQuote; text: string; version: number; suggestion?: string }): { ok: true; thread: PageThread } | PageError {
    let made: PageThread | null = null;
    const result = this.mutate(id, (page, now) => {
      const threads = page.threads ?? [];
      if (threads.length >= THREAD_LIMITS.threads) return refuse(409, "too_many_threads", `A page keeps at most ${THREAD_LIMITS.threads} annotations; resolve and delete some first.`);
      made = { id: randomBytes(9).toString("base64url"), at: now, by: input.by, version: input.version, anchor: input.anchor, text: input.text, replies: [],
        ...(input.suggestion !== undefined ? { suggestion: { text: input.suggestion, state: "open" as const } } : {}) };
      page.threads = [...threads, made];
      return page;
    }, false);
    return "ok" in result ? result : { ok: true, thread: made! };
  }

  reply(id: string, threadId: string, input: { by: string; text: string }): { ok: true; thread: PageThread; reply: PageThreadReply } | PageError {
    let answer: { thread: PageThread; reply: PageThreadReply } | null = null;
    const result = this.mutate(id, (page, now) => {
      const thread = (page.threads ?? []).find((entry) => entry.id === threadId);
      if (!thread) return refuse(404, "no_thread", "This annotation does not exist.");
      if (thread.replies.length >= THREAD_LIMITS.replies) return refuse(409, "too_many_replies", `An annotation keeps at most ${THREAD_LIMITS.replies} replies.`);
      const reply: PageThreadReply = { id: randomBytes(9).toString("base64url"), at: now, by: input.by, text: input.text };
      thread.replies.push(reply);
      answer = { thread, reply };
      return page;
    }, false);
    return "ok" in result ? result : { ok: true, ...answer! };
  }

  /** The page's person accepted or declined a suggestion: it is decided
   * once, and its thread is resolved. */
  decideSuggestion(id: string, threadId: string, input: { by: string; state: "accepted" | "declined"; version?: number }): { ok: true; thread: PageThread } | PageError {
    let found: PageThread | null = null;
    const result = this.mutate(id, (page, now) => {
      const thread = (page.threads ?? []).find((entry) => entry.id === threadId);
      if (!thread?.suggestion) return refuse(404, "no_suggestion", "This suggestion does not exist.");
      if (thread.suggestion.state !== "open") return refuse(409, "decided", "This suggestion was already decided.");
      const decided: PageSuggestion = { ...thread.suggestion, state: input.state, decided: { at: now, by: input.by }, ...(input.version !== undefined ? { version: input.version } : {}) };
      thread.suggestion = decided;
      thread.resolved = { at: now, by: input.by };
      found = thread;
      return page;
    }, false);
    return "ok" in result ? result : { ok: true, thread: found! };
  }

  /** The page's shared state (#1544). */
  state(id: string): Record<string, PageStateEntry> {
    return this.get(id)?.state ?? {};
  }

  /** Who set a value, as a handle of this page only: the same writer gets
   * the same handle on this page and an unrelated one on any other. */
  readerHandle(pageId: string, by: string): string {
    return this.mac(`sagax-page-reader:v1:${pageId}:${by.toLowerCase()}`).slice(0, 12);
  }

  /** A reader not signed in, as their writes are stored: a hash of their
   * browser's own random id, never anything personal. */
  anonymousWriter(readerId: string): string {
    return `anon:${this.mac(`sagax-page-anon:v1:${readerId}`).slice(0, 16)}`;
  }

  /** What the published version declares about its keys (shared/page-state.ts). */
  stateRules(id: string): StateRules {
    const page = this.get(id);
    if (!page || page.currentVersion === null) return {};
    const version = page.versions.find((entry) => entry.n === page.currentVersion);
    if (!version || !pageIsHtml(version.kind)) return {};
    const content = this.content(id, version.n);
    return content === null ? {} : stateRulesOf(content);
  }

  /** What a version declares it uses (#3413, shared/page-capabilities.ts):
   * the published one by default. Read from the stored version itself, so
   * it is what that version holds, whatever the reader's browser sends. Null
   * for a version with no declaration (or not HTML). */
  capabilities(id: string, n?: number): PageCapabilities | null {
    const page = this.get(id);
    const at = n ?? page?.currentVersion ?? null;
    if (!page || at === null) return null;
    const version = page.versions.find((entry) => entry.n === at);
    if (!version || !pageIsHtml(version.kind)) return null;
    const content = this.content(id, version.n);
    return content === null ? null : pageCapabilitiesOf(content);
  }

  /** Whether any HTML version of the page declares a capability that
   * hands it the reader's personal data (#3413). */
  private declaresPersonalData(page: PageRecord): boolean {
    return page.versions.some((version) => pageIsHtml(version.kind) && pageCapabilitiesPersonal(pageCapabilitiesOf(this.content(page.id, version.n) ?? "")));
  }

  /** #3413, the first isolation rule, held by the declaration itself: while
   * the page is shared with anyone but its person and its served version
   * declares a personal data capability, or one ever did (`personalData`,
   * kept on the page for good), its shared state is read only for
   * everyone, its person included. Nothing in memory: it holds across a
   * restart and across a change of version. */
  stateReadOnlyForData(id: string): boolean {
    const page = this.get(id);
    return Boolean(page && pageSharedWithOthers(page) && (page.personalData === true || pageCapabilitiesPersonal(this.capabilities(id))));
  }

  /** The version that becomes current, or the one that stops being current,
   * declares a personal data capability: mark the page for good, revoke
   * included (a reader's frame may still be open on it). Called whenever the
   * current version changes (publish, a kept-updated proposal, revoke). */
  private notePersonalData(page: PageRecord, numbers: ReadonlyArray<number | null>): void {
    if (page.personalData === true) return;
    for (const n of numbers) {
      if (n === null) continue;
      const version = page.versions.find((entry) => entry.n === n);
      if (version && pageIsHtml(version.kind) && pageCapabilitiesPersonal(pageCapabilitiesOf(this.content(page.id, version.n) ?? ""))) {
        page.personalData = true;
        return;
      }
    }
  }

  /** The keys its person made read-only. */
  stateLocks(id: string): string[] {
    return [...(this.get(id)?.stateLocks ?? [])];
  }

  /** Set one key of the page's shared state (`null` clears it), within the
   * keys, size and rate limits; never a read-only key. A reader not signed
   * in (`anon`) has tighter limits, and the writes from their network
   * address are counted too. Never moves the page in its person's list. */
  setState(id: string, input: { key: string; value: unknown; by: string; anon?: { source: string } }): { ok: true; state: Record<string, PageStateEntry> } | PageError {
    if (this.stateReadOnlyForData(id)) return refuse(409, "shared_write_after_data", "This page reads personal data: its shared state is read only while it is shared.");
    const json = stateValueJson(input.value);
    if (json === null) return refuse(400, "bad_value", `value: plain JSON data, at most ${STATE_LIMITS.valueBytes / 1024} KB.`);
    if (input.anon && new TextEncoder().encode(json).length > ANON_STATE_LIMITS.valueBytes) return refuse(400, "bad_value", `value: at most ${ANON_STATE_LIMITS.valueBytes / 1024} KB without signing in.`);
    const now = this.clock();
    const rate = `${id}:${input.by.toLowerCase()}`;
    const recent = (this.stateWrites.get(rate) ?? []).filter((at) => at > now - 60_000);
    if (recent.length >= (input.anon ? ANON_STATE_LIMITS.writesPerMinute : STATE_LIMITS.writesPerMinute)) return refuse(409, "too_many_writes", "Too many changes to this page's state; wait a minute.");
    const sourceRate = input.anon ? `${id}:${input.anon.source}` : "";
    const fromSource = input.anon ? (this.anonSourceWrites.get(sourceRate) ?? []).filter((at) => at > now - 60_000) : [];
    if (input.anon && fromSource.length >= ANON_STATE_LIMITS.sourceWritesPerMinute) return refuse(409, "too_many_writes", "Too many changes to this page's state; wait a minute.");
    let kept: Record<string, PageStateEntry> = {};
    const result = this.mutate(id, (page, at) => {
      if ((page.stateLocks ?? []).includes(input.key)) return refuse(409, "locked", "This value is read-only.");
      const state = { ...page.state };
      if (input.value === null) delete state[input.key];
      else {
        if (!(input.key in state) && Object.keys(state).length >= STATE_LIMITS.keys) return refuse(409, "too_many_keys", `A page keeps at most ${STATE_LIMITS.keys} values.`);
        if (input.anon && !(input.key in state) && Object.values(state).filter((entry) => anonymousBy(entry.by)).length >= ANON_STATE_LIMITS.keys) {
          return refuse(409, "too_many_keys", `A page keeps at most ${ANON_STATE_LIMITS.keys} values set without signing in.`);
        }
        state[input.key] = { value: JSON.parse(json), by: input.by, at };
      }
      if (new TextEncoder().encode(JSON.stringify(state)).length > STATE_LIMITS.totalBytes) return refuse(409, "state_full", `A page keeps at most ${STATE_LIMITS.totalBytes / 1024} KB of state.`);
      page.state = state;
      kept = state;
      return page;
    }, false);
    if ("ok" in result) return result;
    recent.push(now);
    this.stateWrites.set(rate, recent);
    if (input.anon) {
      fromSource.push(now);
      this.anonSourceWrites.set(sourceRate, fromSource);
    }
    for (const map of [this.stateWrites, this.anonSourceWrites]) {
      if (map.size > 10_000) for (const [key, times] of map) if (!times.some((at) => at > now - 60_000)) map.delete(key);
    }
    return { ok: true, state: kept };
  }

  /** Its person clears the whole state. */
  clearState(id: string): { ok: true } | PageError {
    const result = this.mutate(id, (page) => {
      delete page.state;
      return page;
    }, false);
    return "ok" in result ? result : { ok: true };
  }

  /** Its person makes one key read-only, or writable again. */
  lockState(id: string, key: string, locked: boolean): { ok: true; locked: string[] } | PageError {
    let kept: string[] = [];
    const result = this.mutate(id, (page) => {
      const keys = new Set(page.stateLocks ?? []);
      if (locked) {
        if (!keys.has(key) && keys.size >= STATE_LIMITS.keys) return refuse(409, "too_many_keys", `At most ${STATE_LIMITS.keys} read-only values.`);
        keys.add(key);
      } else keys.delete(key);
      kept = [...keys];
      if (kept.length) page.stateLocks = kept;
      else delete page.stateLocks;
      return page;
    }, false);
    return "ok" in result ? result : { ok: true, locked: kept };
  }

  /** The page's bot read its annotations now. */
  markBotRead(id: string): void {
    this.mutate(id, (page, now) => {
      page.botReadAt = now;
      return page;
    }, false);
  }

  /** Resolve or open again; anyone who may annotate. */
  resolveThread(id: string, threadId: string, input: { by: string; resolved: boolean }): { ok: true; thread: PageThread } | PageError {
    let found: PageThread | null = null;
    const result = this.mutate(id, (page, now) => {
      const thread = (page.threads ?? []).find((entry) => entry.id === threadId);
      if (!thread) return refuse(404, "no_thread", "This annotation does not exist.");
      if (input.resolved) thread.resolved = { at: now, by: input.by };
      else delete thread.resolved;
      found = thread;
      return page;
    }, false);
    return "ok" in result ? result : { ok: true, thread: found! };
  }

  /** Delete a thread, or one reply of it (`replyId`). */
  removeThreadPart(id: string, threadId: string, replyId?: string): PageRecord | PageError {
    return this.mutate(id, (page) => {
      const threads = page.threads ?? [];
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return refuse(404, "no_thread", "This annotation does not exist.");
      if (replyId === undefined) {
        page.threads = threads.filter((entry) => entry.id !== threadId);
        return page;
      }
      if (!thread.replies.some((entry) => entry.id === replyId)) return refuse(404, "no_reply", "This reply does not exist.");
      thread.replies = thread.replies.filter((entry) => entry.id !== replyId);
      return page;
    }, false);
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

  /** The person's choice of audience. A room or a group is only stored when
   * they name it here. This does not put the page into that place by itself. */
  share(id: string, audience: PageAudience, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const next = pageAudienceOf(audience);
      if (!samePageAudience(pageAudienceOf(page.audience), next)) {
        page.audience = next;
        page.history.push({ at: now, action: "audience", ...(by ? { by } : {}) });
      }
      return page;
    });
  }

  setPinned(id: string, pinned: boolean, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      if ((page.pinned === true) !== pinned) {
        page.pinned = pinned;
        page.history.push({ at: now, action: "pin", ...(by ? { by } : {}) });
      }
      return page;
    });
  }

  /** #3128: share this page in the bot's Library, or keep it personal. */
  setBotShared(id: string, shared: boolean, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      if ((page.botShared === true) !== shared) {
        if (shared) page.botShared = true;
        else delete page.botShared;
        page.history.push({ at: now, action: "bot-share", ...(by ? { by } : {}) });
      }
      return page;
    });
  }

  /** The published pages shared in the Library of the bots this person may
   * use (#3128), never their own. `mayUse` decides per bot. */
  sharedFor(principalId: string, mayUse: (botId: string) => boolean): PageRecord[] {
    const me = principalId.toLowerCase();
    const now = this.clock();
    const verdict = new Map<string, boolean>();
    return this.load()
      .filter((page) => page.botShared === true && page.status === "published" && (page.ownerId ?? "").toLowerCase() !== me
        && (page.expiresAt === null || page.expiresAt > now))
      .filter((page) => {
        if (!verdict.has(page.botId)) verdict.set(page.botId, mayUse(page.botId));
        return verdict.get(page.botId) === true;
      })
      .map((page) => structuredClone(page))
      .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || b.updatedAt - a.updatedAt);
  }

  /** The person's Share > Add people or groups: who else reads the page
   * while it is shared with "People you invite". Replaces both lists. */
  setInvites(id: string, invites: PageInvites, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const before = JSON.stringify(page.invites ?? { people: [], teams: [] });
      if (before !== JSON.stringify(invites)) {
        page.invites = { people: [...invites.people], teams: [...invites.teams] };
        page.history.push({ at: now, action: "invite", ...(by ? { by } : {}) });
      }
      return page;
    });
  }

  /** The person's list of who else may edit this page (#1704). Replaces it. */
  setEditors(id: string, editors: string[], by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      const before = JSON.stringify(page.editors ?? []);
      if (before !== JSON.stringify(editors)) {
        if (editors.length) page.editors = [...editors];
        else delete page.editors;
        page.history.push({ at: now, action: "editors", ...(by ? { by } : {}) });
      }
      return page;
    });
  }

  /** The person's switch: the bot may replace the published version. */
  setKeepUpdated(id: string, on: boolean, by?: string): PageRecord | PageError {
    return this.mutate(id, (page, now) => {
      if ((page.keepUpdated === true) !== on) {
        page.keepUpdated = on;
        page.history.push({ at: now, action: "live", ...(by ? { by } : {}) });
      }
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
    const result = this.mutate(id, (page, now) => {
      page.status = "revoked";
      delete page.linkId;
      // its shared state goes with the link (#1544)
      delete page.state;
      page.currentVersion = null;
      for (const entry of page.versions) if (entry.state === "published") entry.state = "proposed";
      page.history.push({ at: now, action: "revoke", ...(by ? { by } : {}) });
      return page;
    });
    // what is kept beside the page goes too (#3413: its link approvals)
    if (!("ok" in result)) this.tell(this.revokedListeners, id);
    return result;
  }

  private readonly revokedListeners: Array<(pageId: string) => void> = [];
  private readonly removedListeners: Array<(pageId: string) => void> = [];

  /** Called after a page is revoked, by any path (its person, an admin). */
  onRevoked(listener: (pageId: string) => void): void {
    this.revokedListeners.push(listener);
  }

  /** Called after a page is deleted (#3413: its link and data approvals go). */
  onRemoved(listener: (pageId: string) => void): void {
    this.removedListeners.push(listener);
  }

  /** A listener that fails never turns a saved revoke or delete into an error. */
  private tell(listeners: ReadonlyArray<(pageId: string) => void>, pageId: string): void {
    for (const listener of listeners) {
      try {
        listener(pageId);
      } catch (error) {
        console.warn(`[pages] a listener failed for page ${pageId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  remove(id: string): boolean {
    const pages = this.snapshot();
    const kept = pages.filter((page) => page.id !== id);
    if (kept.length === pages.length) return false;
    this.save(kept);
    this.dropContent(id);
    this.tell(this.removedListeners, id);
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
      ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
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
      audience: pageAudienceOf(page.audience),
      pinned: page.pinned === true,
      keepUpdated: page.keepUpdated === true,
      botShared: page.botShared === true,
      invites: { people: [...(page.invites?.people ?? [])], teams: [...(page.invites?.teams ?? [])] },
      editors: [...(page.editors ?? [])],
      versions,
      ...(page.comments?.length ? { comments: page.comments.length } : {}),
      ...(page.readerComments ? { readerComments: true } : {}),
      ...((page.readerNotes ?? []).some((entry) => entry.status === "pending") ? { pendingReaderComments: page.readerNotes!.filter((entry) => entry.status === "pending").length } : {}),
      ...(path ? { path, url: `${origin.replace(/\/+$/, "")}${path}`, reachable } : {}),
    };
  }
}

/** A page private to its person: shared with nobody (no invite, no editor,
 * not in a bot's Library for others). Pure. */
export function pagePrivateToPerson(page: Pick<PageRecord, "access" | "invites" | "editors" | "botShared">): boolean {
  if (page.access !== "private" || page.botShared === true) return false;
  const invited = (page.invites?.people.length ?? 0) + (page.invites?.teams.length ?? 0);
  return invited === 0 && !(page.editors?.length);
}

/** Someone other than its person may read the page now. Pure. */
export function pageSharedWithOthers(page: Pick<PageRecord, "status" | "access" | "invites" | "editors" | "botShared">): boolean {
  return page.status === "published" && !pagePrivateToPerson(page);
}
