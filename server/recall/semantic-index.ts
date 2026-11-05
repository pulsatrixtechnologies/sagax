// The local semantic index behind automatic recall (server/recall/recall.ts,
// server/recall/semantic-recall.ts). FTS5 finds a note by its words; this index
// finds it by its pieces of words, and by its meaning when the person
// runs an embedding model, so "my dentst apointment" still meets "the
// dentist appointment is on Thursday".
//
// What it indexes: each bot's memory topic files, one line a passage (the
// same files FTS5 recall reads), and the text messages of every
// conversation, a few hundred characters a passage. A search only ever
// looks at the threads its caller allows (the same list FTS5 recall is
// given) and only at the memory lines the place may see.
//
// Where it lives: DATA_DIR/semantic-index.db, owner-only. A row holds
// vectors and a fingerprint, never text. When content encryption is on
// (docs/content-encryption.md) the row is sealed with the key of its
// thread or of its bot's owner, so deleting that key erases the vectors
// too; a key locked on this launch keeps the vectors in memory only. The
// text of a hit is read back from the transcript or the memory file at
// search time, like the FTS5 snippet.
//
// When it updates: a message write tells it (onMessageChange), a memory
// file is compared with what was indexed at every search, and a background
// pass catches up with every conversation a little at a time.

import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { fieldAad, open as openSealed, seal } from "../encryption/content-crypto.ts";
import type { LiveKey } from "../encryption/content-keys.ts";
import { withoutExpired } from "../memory/memory-entries.ts";
import { withoutWiderAudience } from "../memory/memory-audience.ts";
import { topicBody } from "../memory/memory-topics.ts";
import { contentEncryptionOn, contentKeyById, contentKeyForBot, contentKeyForThread, messageThreadIds, onMessageChange, readMessageText, textMessagesAfter, type IndexableMessage } from "../messages/message-db.ts";
import {
  contentWords, EMBEDDING_MIN_SCORE, embedTexts, fingerprint, HASHED_MIN_SCORE, hashedVector, quantize, quantizedCosine,
  type EmbeddingEndpoint, type QuantizedVector,
} from "./semantic-encoder.ts";
import type { SemanticHit, SemanticIndex, SemanticScope } from "./semantic-recall.ts";
import { listMemoryTopics, memoryDate, readMemoryTopic, workspaceDir } from "../workspace/workspace.ts";

/** Characters of a message one passage holds. */
export const MESSAGE_PASSAGE_CHARS = 480;
/** Passages kept of one message: a long reply is mostly its start. */
export const MESSAGE_PASSAGES = 6;
/** Characters of a memory line encoded and shown. */
const MEMORY_LINE_CHARS = 600;
/** Characters of a conversation passage shown in the recall block. */
const SNIPPET_CHARS = 400;
/** A search catches up with its threads for at most this long. */
const SEARCH_CATCH_UP_MS = 150;
/** Vectors kept decrypted in memory, about this many bytes in all. */
const CACHE_BYTES = 96 * 1024 * 1024;
const EMBED_BATCH = 16;
const QUERY_EMBED_TIMEOUT_MS = 1_500;
const EMBED_TIMEOUT_MS = 20_000;
/** An endpoint that failed is left alone this long. */
const ENDPOINT_BACKOFF_MS = 60_000;

const PAYLOAD_VERSION = 1;
const AAD_DOMAIN = "semantic-vector";

interface Entry {
  /** memory: the topic file name; conversation: the message id */
  ref: string;
  part: number;
  at: number;
  fp: Buffer;
  hashed: QuantizedVector;
  model?: string;
  embedded?: QuantizedVector;
  /** memory lines only, in memory only: the line itself */
  text?: string;
}

// ── payload: vectors and fingerprint, sealed when encryption is on ──────

function encodePayload(entry: Entry): Buffer {
  const model = Buffer.from(entry.model ?? "", "utf8").subarray(0, 255);
  const embedded = entry.embedded?.values ?? new Int8Array(0);
  const out = Buffer.alloc(1 + 16 + 4 + 2 + entry.hashed.values.length + 1 + model.length + 4 + 2 + embedded.length);
  let at = 0;
  out[at++] = PAYLOAD_VERSION;
  entry.fp.copy(out, at, 0, 16); at += 16;
  out.writeFloatLE(entry.hashed.scale, at); at += 4;
  out.writeUInt16LE(entry.hashed.values.length, at); at += 2;
  Buffer.from(entry.hashed.values.buffer, entry.hashed.values.byteOffset, entry.hashed.values.length).copy(out, at); at += entry.hashed.values.length;
  out[at++] = model.length;
  model.copy(out, at); at += model.length;
  out.writeFloatLE(entry.embedded?.scale ?? 0, at); at += 4;
  out.writeUInt16LE(embedded.length, at); at += 2;
  Buffer.from(embedded.buffer, embedded.byteOffset, embedded.length).copy(out, at);
  return out;
}

function decodePayload(buffer: Buffer): Pick<Entry, "fp" | "hashed" | "model" | "embedded"> | null {
  try {
    let at = 0;
    if (buffer[at++] !== PAYLOAD_VERSION) return null;
    const fp = Buffer.from(buffer.subarray(at, at + 16)); at += 16;
    const scale = buffer.readFloatLE(at); at += 4;
    const dim = buffer.readUInt16LE(at); at += 2;
    const hashed = { scale, values: new Int8Array(Uint8Array.from(buffer.subarray(at, at + dim)).buffer) }; at += dim;
    const modelLength = buffer[at++]!;
    const model = buffer.subarray(at, at + modelLength).toString("utf8"); at += modelLength;
    const escale = buffer.readFloatLE(at); at += 4;
    const edim = buffer.readUInt16LE(at); at += 2;
    const embedded = edim ? { scale: escale, values: new Int8Array(Uint8Array.from(buffer.subarray(at, at + edim)).buffer) } : undefined;
    return { fp, hashed, ...(model && embedded ? { model, embedded } : {}) };
  } catch {
    return null;
  }
}

const entryBytes = (entry: Entry) => entry.hashed.values.length + (entry.embedded?.values.length ?? 0) + 96;
const bytesOf = (entries: readonly Entry[]) => entries.reduce((sum, entry) => sum + entryBytes(entry), 0);

// ── passages ───────────────────────────────────────────────────────────

/** A message cut into passages: paragraphs and sentences packed up to
 * MESSAGE_PASSAGE_CHARS, at most MESSAGE_PASSAGES of them. */
export function messagePassages(text: string): string[] {
  const pieces = text
    .replace(/\r/g, "")
    .split(/\n{2,}|(?<=[.!?])\s+(?=\p{Lu})/u)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    for (let start = 0; start < piece.length; start += MESSAGE_PASSAGE_CHARS) {
      const slice = piece.slice(start, start + MESSAGE_PASSAGE_CHARS);
      if (current && current.length + 1 + slice.length > MESSAGE_PASSAGE_CHARS) {
        out.push(current);
        if (out.length >= MESSAGE_PASSAGES) return out;
        current = "";
      }
      current = current ? `${current} ${slice}` : slice;
    }
  }
  if (current && out.length < MESSAGE_PASSAGES) out.push(current);
  return out;
}

/** The lines of a topic file worth a passage: its body, one line each,
 * skipping lines with no content word. */
export function memoryLines(raw: string): string[] {
  return topicBody(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !/^#{1,6}\s/.test(line) && contentWords(line).length > 0);
}

// ── the index ─────────────────────────────────────────────────────────

export interface LocalSemanticIndexOptions {
  /** The SQLite file (default DATA_DIR/semantic-index.db). */
  file: string;
  /** Off: ready() is false and nothing new is indexed. Read live. */
  enabled: () => boolean;
  /** The person's embedding endpoint, or null for the built-in vectors only. Read live. */
  endpoint: () => EmbeddingEndpoint | null;
  fetcher?: typeof fetch;
}

export interface SemanticIndexStatus {
  enabled: boolean;
  encoder: "built-in" | "endpoint";
  model?: string;
  /** whether the endpoint answered its last call; absent before any call */
  endpointOk?: boolean;
  memoryPassages: number;
  conversationPassages: number;
}

type ThreadState = { last: number; dirty: Set<string>; blocked: boolean };

export class LocalSemanticIndex implements SemanticIndex {
  private db: DatabaseSync;
  private readonly options: LocalSemanticIndexOptions;
  /** scope -> entries, least recently used first */
  private cache = new Map<string, Entry[]>();
  private cacheBytes = 0;
  /** memory scope -> topic file -> the raw text it was indexed from */
  private memoryText = new Map<string, Map<string, string>>();
  private threads = new Map<string, ThreadState>();
  /** threads not yet caught up, in the order the background pass takes them */
  private backlog: string[] = [];
  private backlogListedAt = 0;
  private embedQueue = new Map<string, Set<string>>();
  private queryVectors = new Map<string, { model: string; vector: Float32Array }>();
  private endpointFailedAt = 0;
  private endpointOk: boolean | undefined;
  private embedding = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(options: LocalSemanticIndexOptions) {
    this.options = options;
    mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 });
    closeSync(openSync(options.file, "a", 0o600));
    try { chmodSync(options.file, 0o600); } catch {}
    this.db = new DatabaseSync(options.file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS passages (
        scope TEXT NOT NULL,
        ref TEXT NOT NULL,
        part INTEGER NOT NULL,
        at INTEGER NOT NULL,
        key_id TEXT,
        payload BLOB NOT NULL,
        PRIMARY KEY (scope, ref, part)
      );
      CREATE TABLE IF NOT EXISTS marks (
        scope TEXT PRIMARY KEY,
        last INTEGER NOT NULL
      );
    `);
  }

  /** Follow message writes and catch up in the background. */
  start(intervalMs = 1_500): void {
    this.unsubscribe ??= onMessageChange((threadId, messageId) => this.noteMessage(threadId, messageId));
    this.timer ??= setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    try { this.db.close(); } catch {}
  }

  ready(_botId: string): boolean {
    return this.options.enabled();
  }

  /** Embed the query ahead of a sync search, when an endpoint is set. */
  async prepare(_botId: string, query: string): Promise<void> {
    const endpoint = this.liveEndpoint();
    if (!endpoint || this.queryVectors.has(`${endpoint.model}\n${query}`)) return;
    const vectors = await this.embed(endpoint, [query], QUERY_EMBED_TIMEOUT_MS);
    if (!vectors?.[0]) return;
    this.queryVectors.set(`${endpoint.model}\n${query}`, { model: endpoint.model, vector: vectors[0] });
    while (this.queryVectors.size > 32) this.queryVectors.delete(this.queryVectors.keys().next().value!);
  }

  search(botId: string, query: string, limit: number, scope: SemanticScope): SemanticHit[] {
    if (!this.options.enabled() || limit < 1 || !contentWords(query).length) return [];
    const hashedQuery = hashedVector(query);
    const endpoint = this.liveEndpoint();
    const embeddedQuery = endpoint ? this.queryVectors.get(`${endpoint.model}\n${query}`) : undefined;
    const score = (entry: Entry) => {
      const hashed = quantizedCosine(hashedQuery, entry.hashed) / HASHED_MIN_SCORE;
      const meaning = embeddedQuery && entry.embedded && entry.model === embeddedQuery.model
        ? quantizedCosine(embeddedQuery.vector, entry.embedded) / EMBEDDING_MIN_SCORE
        : 0;
      return Math.max(hashed, meaning);
    };
    const hits: SemanticHit[] = [];

    // memory: the lines this place may see, compared with the files first
    const visible = this.syncMemory(botId, scope);
    const memoryBest = new Map<string, { entry: Entry; score: number }>();
    for (const entry of this.cache.get(memoryScope(botId)) ?? []) {
      if (!entry.text || !visible.get(entry.ref)?.has(entry.text)) continue;
      const value = score(entry);
      if (value < 1) continue;
      const best = memoryBest.get(entry.ref);
      if (!best || value > best.score) memoryBest.set(entry.ref, { entry, score: value });
    }
    for (const { entry, score: value } of memoryBest.values()) {
      const line = entry.text!;
      hits.push({ source: "memory", label: `memory/${entry.ref}`, snippet: line.length > MEMORY_LINE_CHARS ? `${line.slice(0, MEMORY_LINE_CHARS)}…` : line, score: value });
    }

    // conversations: only the threads the caller allows
    const deadline = performance.now() + SEARCH_CATCH_UP_MS;
    const scored: Array<{ threadId: string; entry: Entry; score: number }> = [];
    for (const threadId of new Set(scope.threadIds)) {
      if (performance.now() < deadline) this.catchUp(threadId, deadline);
      for (const entry of this.loadScope(threadScope(threadId))) {
        const value = score(entry);
        if (value >= 1) scored.push({ threadId, entry, score: value });
      }
    }
    scored.sort((a, b) => b.score - a.score || b.entry.at - a.entry.at);
    const seen = new Set<string>();
    let conversations = 0;
    for (const { threadId, entry, score: value } of scored) {
      if (conversations >= limit) break;
      const key = `${threadId}\n${entry.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const message = readMessageText(threadId, entry.ref);
      if (!message) {
        this.dropRef(threadScope(threadId), entry.ref);
        continue;
      }
      const passage = messagePassages(message.text)[entry.part];
      if (!passage) continue;
      conversations += 1;
      hits.push({
        source: "conversation",
        label: threadId,
        threadId,
        role: message.role,
        ...(message.from ? { from: message.from } : {}),
        ...(message.peer ? { peer: message.peer } : {}),
        snippet: passage.length > SNIPPET_CHARS ? `${passage.slice(0, SNIPPET_CHARS)}…` : passage,
        score: value,
        at: message.at,
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** What the bot's settings show: the encoder, and how many passages of
   * its memory and of the given conversations (its own) are indexed. */
  status(botId: string, threadIds: readonly string[]): SemanticIndexStatus {
    const endpoint = this.liveEndpoint(true);
    const count = (scope: string) => (this.db.prepare("SELECT COUNT(*) AS n FROM passages WHERE scope = ?").get(scope) as { n: number }).n;
    const memory = count(memoryScope(botId));
    const conversations = [...new Set(threadIds)].reduce((sum, threadId) => sum + count(threadScope(threadId)), 0);
    return {
      enabled: this.options.enabled(),
      encoder: endpoint ? "endpoint" : "built-in",
      ...(endpoint ? { model: endpoint.model } : {}),
      ...(endpoint && this.endpointOk !== undefined ? { endpointOk: this.endpointOk } : {}),
      memoryPassages: memory,
      conversationPassages: conversations,
    };
  }

  /** One background step: changed messages, then threads not yet indexed,
   * then embeddings. Bounded so a turn never waits on it. */
  tick(budgetMs = 40): void {
    if (!this.options.enabled()) return;
    const deadline = performance.now() + budgetMs;
    try {
      for (const [threadId, state] of this.threads) {
        if (performance.now() > deadline) return;
        if (state.dirty.size) this.catchUp(threadId, deadline);
      }
      if (!this.backlog.length && Date.now() - this.backlogListedAt > 10 * 60_000) {
        this.backlogListedAt = Date.now();
        const known = new Set<string>();
        for (const threadId of messageThreadIds()) {
          known.add(threadId);
          this.backlog.push(threadId);
        }
        this.sweep(known);
      }
      while (this.backlog.length && performance.now() < deadline) {
        const threadId = this.backlog[0]!;
        if (this.catchUp(threadId, deadline)) this.backlog.shift();
      }
    } catch (error) {
      console.warn(`semantic index: ${(error as Error).message}`);
    }
    if (!this.embedding && this.embedQueue.size) void this.embedSome();
  }

  /** Catch one thread up to its newest message. True when it is current. */
  catchUp(threadId: string, deadline: number): boolean {
    const scope = threadScope(threadId);
    const state = this.threadState(threadId);
    for (const messageId of state.dirty) {
      if (performance.now() > deadline) return false;
      state.dirty.delete(messageId);
      const message = readMessageText(threadId, messageId);
      // a streamed reply is written empty, then filled: index what it says now
      if (message?.text.trim()) this.indexMessage(threadId, { rowid: 0, messageId, at: message.at, text: message.text });
      else this.dropRef(scope, messageId);
    }
    if (state.blocked) return true;
    while (performance.now() < deadline) {
      const before = state.last;
      const { messages, last, blocked } = textMessagesAfter(threadId, before, 64);
      for (const message of messages) this.indexMessage(threadId, message);
      if (last !== before) {
        state.last = last;
        if (this.mayPersist(scope)) this.db.prepare("INSERT INTO marks (scope, last) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET last = excluded.last").run(scope, last);
      }
      if (blocked) {
        state.blocked = true;
        return true;
      }
      if (last === before) return true;
    }
    return false;
  }

  private noteMessage(threadId: string, messageId: string | null): void {
    if (messageId === null) {
      this.forgetThread(threadId);
      return;
    }
    const state = this.threadState(threadId);
    state.blocked = false;
    state.dirty.add(messageId);
  }

  private threadState(threadId: string): ThreadState {
    let state = this.threads.get(threadId);
    if (!state) {
      const row = this.db.prepare("SELECT last FROM marks WHERE scope = ?").get(threadScope(threadId)) as { last: number } | undefined;
      state = { last: row?.last ?? 0, dirty: new Set(), blocked: false };
      this.threads.set(threadId, state);
    }
    return state;
  }

  private indexMessage(threadId: string, message: IndexableMessage): void {
    const scope = threadScope(threadId);
    const entries = messagePassages(message.text).map((text, part): Entry => ({
      ref: message.messageId, part, at: message.at, fp: fingerprint(text), hashed: quantize(hashedVector(text)),
    }));
    this.replaceRef(scope, message.messageId, entries);
    if (this.liveEndpoint()) this.queueEmbedding(scope, message.messageId);
  }

  /** Re-read a bot's topic files, re-index the ones that changed, and say
   * which lines this place may see, by file. */
  private syncMemory(botId: string, scope: SemanticScope): Map<string, Set<string>> {
    const key = memoryScope(botId);
    const entries = this.loadScope(key);
    const known = this.memoryText.get(key) ?? new Map<string, string>();
    this.memoryText.set(key, known);
    const visible = new Map<string, Set<string>>();
    const today = memoryDate();
    const present = new Set<string>();
    let topics: Array<{ name: string }> = [];
    try { topics = listMemoryTopics(botId); } catch { topics = []; }
    for (const { name } of topics) {
      if (name === "archive.md") continue;
      let raw: string | null;
      try { raw = readMemoryTopic(botId, name); } catch { raw = null; }
      if (raw === null) continue;
      present.add(name);
      if (known.get(name) !== raw) {
        const reuse = new Map(entries.filter((entry) => entry.ref === name).map((entry) => [entry.fp.toString("hex"), entry]));
        const lines = memoryLines(raw);
        const next = lines.map((line, part): Entry => {
          const fp = fingerprint(line);
          const old = reuse.get(fp.toString("hex"));
          return { ref: name, part, at: 0, fp, text: line, hashed: old?.hashed ?? quantize(hashedVector(line.slice(0, MEMORY_LINE_CHARS))), ...(old?.embedded ? { model: old.model!, embedded: old.embedded } : {}) };
        });
        this.replaceRef(key, name, next);
        known.set(name, raw);
        const endpoint = this.liveEndpoint();
        if (endpoint && next.some((entry) => entry.model !== endpoint.model)) this.queueEmbedding(key, name);
      }
      const shown = withoutExpired(raw, today).text;
      const place = scope.audience ? withoutWiderAudience(shown, scope.audience).text : shown;
      visible.set(name, new Set(place.split("\n").map((line) => line.trim())));
    }
    for (const name of known.keys()) if (!present.has(name)) known.delete(name);
    for (const ref of new Set(entries.map((entry) => entry.ref))) if (!present.has(ref)) this.dropRef(key, ref);
    return visible;
  }

  // ── storage ─────────────────────────────────────────────────────────

  private keyFor(scope: string): LiveKey | null {
    return scope.startsWith("t:") ? contentKeyForThread(scope.slice(2)) : contentKeyForBot(scope.slice(2));
  }

  /** Vectors are written to disk plain only when encryption is off, and
   * sealed only under a key that is open now. */
  private mayPersist(scope: string): boolean {
    return !contentEncryptionOn() || this.keyFor(scope) !== null;
  }

  private replaceRef(scope: string, ref: string, entries: Entry[]): void {
    const key = contentEncryptionOn() ? this.keyFor(scope) : null;
    const persist = !contentEncryptionOn() || key !== null;
    if (persist) {
      this.db.exec("BEGIN");
      try {
        this.db.prepare("DELETE FROM passages WHERE scope = ? AND ref = ?").run(scope, ref);
        const insert = this.db.prepare("INSERT INTO passages (scope, ref, part, at, key_id, payload) VALUES (?, ?, ?, ?, ?, ?)");
        for (const entry of entries) {
          const payload = encodePayload(entry);
          insert.run(scope, ref, entry.part, entry.at, key?.keyId ?? null, key ? seal(key.dek, payload, aad(key, scope, ref, entry.part)) : payload);
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const cached = this.cache.get(scope);
    if (cached || !persist) {
      // a scope not on disk (its key locked) lives in memory until the key opens
      const old = cached ?? [];
      const kept = old.filter((entry) => entry.ref !== ref);
      this.cacheBytes += bytesOf(entries) - (bytesOf(old) - bytesOf(kept));
      this.cache.set(scope, [...kept, ...entries]);
      this.trimCache(scope);
    }
  }

  private dropRef(scope: string, ref: string): void {
    this.db.prepare("DELETE FROM passages WHERE scope = ? AND ref = ?").run(scope, ref);
    const cached = this.cache.get(scope);
    if (cached) {
      const kept = cached.filter((entry) => entry.ref !== ref);
      this.cacheBytes -= bytesOf(cached) - bytesOf(kept);
      this.cache.set(scope, kept);
    }
  }

  private forgetThread(threadId: string): void {
    const scope = threadScope(threadId);
    this.db.prepare("DELETE FROM passages WHERE scope = ?").run(scope);
    this.db.prepare("DELETE FROM marks WHERE scope = ?").run(scope);
    const cached = this.cache.get(scope);
    if (cached) this.cacheBytes -= bytesOf(cached);
    this.cache.delete(scope);
    this.threads.delete(threadId);
    this.embedQueue.delete(scope);
    this.backlog = this.backlog.filter((id) => id !== threadId);
  }

  /** Rows of threads that no longer exist and of bots whose workspace is gone. */
  private sweep(threadsWithMessages: Set<string>): void {
    const scopes = (this.db.prepare("SELECT DISTINCT scope FROM passages").all() as Array<{ scope: string }>).map((row) => row.scope);
    for (const scope of scopes) {
      if (scope.startsWith("t:") && !threadsWithMessages.has(scope.slice(2))) this.forgetThread(scope.slice(2));
      if (scope.startsWith("m:") && !existsSync(workspaceDir(scope.slice(2)))) {
        this.db.prepare("DELETE FROM passages WHERE scope = ?").run(scope);
        this.cache.delete(scope);
      }
    }
  }

  /** A scope's entries, opened from disk on first use. A row whose key was
   * destroyed is deleted (erased); one whose key is locked is skipped. */
  private loadScope(scope: string): Entry[] {
    const cached = this.cache.get(scope);
    if (cached) {
      this.cache.delete(scope);
      this.cache.set(scope, cached);
      return cached;
    }
    const rows = this.db.prepare("SELECT ref, part, at, key_id, payload FROM passages WHERE scope = ? ORDER BY ref, part").all(scope) as Array<{ ref: string; part: number; at: number; key_id: string | null; payload: Uint8Array }>;
    const entries: Entry[] = [];
    const erased: Array<{ ref: string; part: number }> = [];
    for (const row of rows) {
      let payload: Buffer;
      if (row.key_id) {
        const key = contentKeyById(row.key_id);
        if (key === "destroyed") { erased.push(row); continue; }
        if (!key) continue;
        try { payload = openSealed(key.dek, row.payload, aad(key, scope, row.ref, row.part)); } catch { erased.push(row); continue; }
      } else {
        payload = Buffer.from(row.payload);
      }
      const decoded = decodePayload(payload);
      if (decoded) entries.push({ ref: row.ref, part: row.part, at: row.at, ...decoded });
    }
    for (const row of erased) this.db.prepare("DELETE FROM passages WHERE scope = ? AND ref = ? AND part = ?").run(scope, row.ref, row.part);
    this.cache.set(scope, entries);
    this.cacheBytes += bytesOf(entries);
    this.trimCache(scope);
    const endpoint = this.liveEndpoint();
    if (endpoint && scope.startsWith("t:")) {
      for (const entry of entries) if (entry.model !== endpoint.model) this.queueEmbedding(scope, entry.ref);
    }
    return entries;
  }

  private trimCache(keep: string): void {
    for (const scope of this.cache.keys()) {
      if (this.cacheBytes <= CACHE_BYTES) return;
      if (scope === keep || scope.startsWith("m:")) continue;
      this.cacheBytes -= bytesOf(this.cache.get(scope)!);
      this.cache.delete(scope);
    }
  }

  // ── the person's embedding endpoint ──────────────────────────────────

  private liveEndpoint(ignoreBackoff = false): EmbeddingEndpoint | null {
    const endpoint = this.options.endpoint();
    if (!endpoint?.url.trim() || !endpoint.model.trim()) return null;
    if (!ignoreBackoff && this.endpointFailedAt && Date.now() - this.endpointFailedAt < ENDPOINT_BACKOFF_MS) return null;
    return endpoint;
  }

  private async embed(endpoint: EmbeddingEndpoint, texts: string[], timeoutMs: number): Promise<Float32Array[] | null> {
    const vectors = await embedTexts(endpoint, texts, timeoutMs, this.options.fetcher);
    this.endpointOk = vectors !== null;
    if (!vectors) this.endpointFailedAt = Date.now();
    else this.endpointFailedAt = 0;
    return vectors;
  }

  private queueEmbedding(scope: string, ref: string): void {
    let refs = this.embedQueue.get(scope);
    if (!refs) this.embedQueue.set(scope, (refs = new Set()));
    refs.add(ref);
  }

  /** Embed a batch of queued passages with the endpoint, then store them. */
  async embedSome(): Promise<void> {
    const endpoint = this.liveEndpoint();
    if (!endpoint || this.embedding) return;
    this.embedding = true;
    try {
      const batch: Array<{ scope: string; ref: string; entries: Entry[]; texts: string[] }> = [];
      let count = 0;
      for (const [scope, refs] of this.embedQueue) {
        for (const ref of refs) {
          if (count >= EMBED_BATCH) break;
          refs.delete(ref);
          const texts = this.passageTexts(scope, ref);
          if (!texts) continue;
          const entries = this.loadScope(scope).filter((entry) => entry.ref === ref).sort((a, b) => a.part - b.part);
          if (entries.length !== texts.length) continue;
          batch.push({ scope, ref, entries, texts });
          count += texts.length;
        }
        if (!refs.size) this.embedQueue.delete(scope);
        if (count >= EMBED_BATCH) break;
      }
      if (!batch.length) return;
      const vectors = await this.embed(endpoint, batch.flatMap((item) => item.texts), EMBED_TIMEOUT_MS);
      if (!vectors) {
        for (const item of batch) this.queueEmbedding(item.scope, item.ref);
        return;
      }
      let at = 0;
      for (const item of batch) {
        const updated = item.entries.map((entry) => ({ ...entry, model: endpoint.model, embedded: quantize(vectors[at++]!) }));
        this.replaceRef(item.scope, item.ref, updated);
      }
    } catch (error) {
      console.warn(`semantic index: embeddings failed: ${(error as Error).message}`);
    } finally {
      this.embedding = false;
    }
  }

  private passageTexts(scope: string, ref: string): string[] | null {
    if (scope.startsWith("m:")) {
      const raw = this.memoryText.get(scope)?.get(ref);
      return raw === undefined ? null : memoryLines(raw).map((line) => line.slice(0, MEMORY_LINE_CHARS));
    }
    const message = readMessageText(scope.slice(2), ref);
    return message ? messagePassages(message.text) : null;
  }
}

const memoryScope = (botId: string) => `m:${botId}`;
const threadScope = (threadId: string) => `t:${threadId}`;
const aad = (key: LiveKey, scope: string, ref: string, part: number) => fieldAad(key.keyId, key.owner, AAD_DOMAIN, `${scope}\u0000${ref}\u0000${part}`);

/** The default file beside the other databases. */
export function semanticIndexFile(dataDir: string): string {
  return join(dataDir, "semantic-index.db");
}

/** Whether the file exists yet (a fresh install has none until a search). */
export function semanticIndexExists(dataDir: string): boolean {
  return existsSync(semanticIndexFile(dataDir));
}
