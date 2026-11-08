// SQLite persistence for thread transcripts.
//
// messages-<threadId>.json rewrote the WHOLE thread file on every append —
// a long computer-use thread reaches megabytes, so each new message cost
// more disk than the last. This store writes deltas instead: one INSERT
// per message, one UPDATE per patch, and reads a thread once into the
// Store's in-memory cache. node:sqlite (built into Node ≥23.4) keeps it
// dependency-free — nothing new to bundle for the packaged app.
//
// Legacy JSON thread files import lazily: the first read of a thread with
// no rows pulls the old file in, after which the DB is the source of
// truth (the JSON file is left behind as a one-time backup).
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { DATA_DIR } from "../config.ts";
import { ContentSealError, fieldAad, messageAad, openField, openText, seal, sealField, sealedFieldKeyId } from "../encryption/content-crypto.ts";
import { provideContentKeys, type ExportedContentKey } from "../content-export.ts";
import { ContentKeyring, ContentKeyUnavailable, ensureContentKeySchema, localKekProvider, WORKSPACE_OWNER, type KekProvider, type LiveKey } from "../encryption/content-keys.ts";
import { resolveVaultKey } from "../mcp/mcp-oauth.ts";
import { blindSnippet, indexColumns, indexSourcesOf, recallHolds, recallMatch, recallTermsFor, skeletonOf, type RecallTerm } from "../encryption/message-sealing.ts";
import { peerProvenanceAuthor, WEBHOOK_AUTHOR, type WorkOrigin } from "../peers/peer-provenance.ts";
import type { ResolvedSender, SteerQueueReason, WireMessage as Message } from "../../shared/wire.ts";
import type { UsageTrigger } from "../usage/usage-ledger.ts";
import { MessageSearchWorker } from "../message-search-worker.ts";
import { searchMessagesInDatabase, type SealedKeyMaterial, type SearchHit } from "./message-search-query.ts";
import { reportBackgroundError } from "../background-error.ts";
import { ensureMemoryIndex } from "./message-db-memory-index.ts";
export type { SearchHit } from "./message-search-query.ts";

const DB_FILE = () => join(DATA_DIR, "messages.db");

let handle: DatabaseSync | null = null;
let handlePath: string | null = null;
let handleCheckedAt = 0;
/** SQLite keeps writing to a database file deleted under it without an error, so the file is looked for again this often. */
const FILE_RECHECK_MS = 1_000;
let searchWorker: MessageSearchWorker | null = null;
let closingSearch: Promise<void> = Promise.resolve();

function open(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = DB_FILE();
  // Transcripts can contain private conversations and tool output. Create
  // the database with owner-only permissions and also repair an existing
  // file that may have inherited a permissive umask.
  closeSync(openSync(file, "a", 0o600));
  try {
    chmodSync(file, 0o600);
  } catch {}
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      thread_id TEXT NOT NULL,
      id TEXT NOT NULL,
      at INTEGER NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT,
      json TEXT NOT NULL,
      PRIMARY KEY (thread_id, id)
    );
    CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id);
    -- at is not part of the primary key, so newest-per-thread reads cannot
    -- walk these rows in time order on messages_thread. Created on every
    -- open, including a database that already has messages.
    CREATE INDEX IF NOT EXISTS messages_thread_at ON messages(thread_id, at);
    -- kind-filtered scans: working goal runs and similar.
    CREATE INDEX IF NOT EXISTS messages_kind ON messages(kind);
    CREATE TABLE IF NOT EXISTS thread_state (
      thread_id TEXT PRIMARY KEY,
      active_leaf_id TEXT
    );
    CREATE TABLE IF NOT EXISTS thread_reads (
      thread_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (thread_id, participant_id)
    );
    CREATE TABLE IF NOT EXISTS chat_followups (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      send_id TEXT,
      status TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_followups_receipt ON chat_followups(kind, owner_id, thread_id, send_id);
    -- deleteThread / rebind followups by thread alone (receipt index is kind-led).
    CREATE INDEX IF NOT EXISTS chat_followups_thread ON chat_followups(thread_id);
    CREATE TABLE IF NOT EXISTS command_receipts (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      at INTEGER NOT NULL,
      result TEXT NOT NULL,
      PRIMARY KEY (kind, key)
    );
  `);
  ensureRecallIndex(db);
  ensureMemoryIndex(db);
  ensureSealedSchema(db);
  return db;
}

// Content encryption at rest (docs/content-encryption.md): a sealed row has
// `sealed` (AES-256-GCM of the whole message), `key_id` (its content key),
// no `text`, and a cleartext projection in `json` (message-sealing.ts).
// Its blind index is a row of message_index (the keyed Bloom filter of a
// text or activity row; `words` when its keyed words are in
// messages_sealed_fts), written just after the row; no index row yet means
// not indexed yet. Plain rows have all three
// empty, so a database never encrypted reads exactly as before.
function ensureSealedSchema(db: DatabaseSync): void {
  const columns = new Set((db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("sealed")) db.exec("ALTER TABLE messages ADD COLUMN sealed BLOB");
  if (!columns.has("key_id")) db.exec("ALTER TABLE messages ADD COLUMN key_id TEXT");
  ensureContentKeySchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thread_keys (
      thread_id TEXT PRIMARY KEY,
      key_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS thread_keys_key_id ON thread_keys(key_id);
    -- After key_id exists: erase-by-owner and migration scans.
    CREATE INDEX IF NOT EXISTS messages_key_id ON messages(key_id) WHERE key_id IS NOT NULL;
    -- Open permission cards at restart: json projection is cleartext even when sealed.
    CREATE INDEX IF NOT EXISTS messages_open_permission_cards ON messages(thread_id)
      WHERE json_extract(json, '$.card.requestType') = 'permission'
        AND json_extract(json, '$.card.requestId') IS NOT NULL
        AND json_extract(json, '$.card.answered') IS NULL
        AND COALESCE(json_extract(json, '$.card.dismissed'), 0) = 0
        AND COALESCE(json_extract(json, '$.card.expired'), 0) = 0;
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_sealed_fts USING fts5(
      words, prefixes, content='', contentless_delete=1, detail=column
    );
    CREATE TABLE IF NOT EXISTS message_index (
      rowid INTEGER PRIMARY KEY,
      thread_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      key_id TEXT NOT NULL,
      words INTEGER NOT NULL,
      bloom BLOB
    );
    CREATE INDEX IF NOT EXISTS message_index_thread ON message_index(thread_id);
    CREATE TRIGGER IF NOT EXISTS messages_sealed_ad AFTER DELETE ON messages WHEN old.key_id IS NOT NULL BEGIN
      DELETE FROM messages_sealed_fts WHERE rowid IN (SELECT rowid FROM message_index WHERE rowid = old.rowid AND words = 1);
      DELETE FROM message_index WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS messages_sealed_au AFTER UPDATE OF sealed, key_id ON messages WHEN old.key_id IS NOT NULL BEGIN
      DELETE FROM messages_sealed_fts WHERE rowid IN (SELECT rowid FROM message_index WHERE rowid = old.rowid AND words = 1);
      DELETE FROM message_index WHERE rowid = old.rowid;
    END;
  `);
}

// Ranked recall over transcript text, for the bot's own session_search tool.
// An external-content FTS5 table over messages.text: the index stores no
// copy of the text, and three triggers keep it in step with every insert,
// update, and delete on `messages`. FTS5 ships inside node:sqlite, so this
// is no more of a dependency than the table it indexes. The sidebar's LIKE
// search below stays as it is — substring find over a single thread wants
// every occurrence, not a relevance ranking.
/** FTS5 is in every runtime Sagax supports — node:sqlite on Node ≥ 24
 * (package.json engines) and the Node inside Electron 43 — so a SQLite
 * without it is a mis-installed runtime, not a mode to run in. Say that,
 * instead of surfacing SQLite's own "no such module: fts5" from deep inside
 * open() with nothing about what to do. Anything else is rethrown as-is. */
export function describeMissingFts5(error: unknown): Error | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/no such module:\s*fts5/i.test(message)) return null;
  return new Error(
    `Sagax needs SQLite with FTS5, which is built into Node 24 and newer (and into the app). ` +
    `This Node (${process.version}) has none: install Node 24 or newer. (${message})`,
  );
}

function ensureRecallIndex(db: DatabaseSync): void {
  const existed = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'")
    .get();
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        text, content='messages', content_rowid='rowid', tokenize='unicode61'
      );
    `);
  } catch (error) {
    throw describeMissingFts5(error) ?? error;
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
  `);
  // First time on an existing database: index everything already there.
  if (!existed) db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')");
}

// INSERT OR REPLACE would delete and re-insert the row under a new rowid
// without firing the delete trigger (SQLite only fires it with recursive
// triggers on), leaving a dangling FTS entry. An upsert keeps the rowid and
// runs the update trigger, so the index never drifts from the table.
const UPSERT_MESSAGE =
  "INSERT INTO messages (thread_id, id, at, role, kind, text, json, sealed, key_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(thread_id, id) DO UPDATE SET at = excluded.at, role = excluded.role, kind = excluded.kind, " +
  "text = excluded.text, json = excluded.json, sealed = excluded.sealed, key_id = excluded.key_id RETURNING rowid";

/** The live handle — reopened when the file was removed out from under us
 * (tests wipe DATA_DIR between cases; a fresh Store must get a fresh DB,
 * not a handle onto an unlinked inode). The file is looked for again at most
 * once a second: SQLite keeps writing to a deleted inode without error. */
function db(): DatabaseSync {
  const file = DB_FILE();
  if (handle && handlePath === file && Date.now() - handleCheckedAt < FILE_RECHECK_MS) return handle;
  if (handle && handlePath === file && existsSync(file)) {
    handleCheckedAt = Date.now();
    return handle;
  }
  try {
    handle?.close();
  } catch {}
  // a new database: none of the old one's keys, bindings or queued tokens apply
  forgetSealingState();
  handle = open();
  handlePath = file;
  handleCheckedAt = Date.now();
  scheduleMigration();
  return handle;
}

/** Statements prepared once per handle: the write and read paths run per message. */
const statements = new Map<string, StatementSync>();
function cached(sql: string): StatementSync {
  const database = db();
  let statement = statements.get(sql);
  if (!statement) {
    statement = database.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}

/** Nested writes use savepoints: even a caught inner error must not commit
 * half of an inner command. The outer transaction still owns durability. */
let transactionDepth = 0;
function transaction<T>(fn: (database: DatabaseSync) => T): T {
  const database = db();
  if (transactionDepth > 0) {
    const savepoint = `command_${transactionDepth}`;
    database.exec(`SAVEPOINT ${savepoint}`);
    transactionDepth += 1;
    try {
      const result = fn(database);
      database.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      database.exec(`ROLLBACK TO ${savepoint}`);
      database.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally { transactionDepth -= 1; }
  }
  database.exec("BEGIN IMMEDIATE");
  transactionDepth = 1;
  try {
    const result = fn(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    transactionDepth = 0;
  }
}

// ---------------------------------------------------------------------------
// Content encryption at rest (docs/content-encryption.md)

export type ContentEncryptionMode = "on" | "off";

/** Who a thread's content belongs to: its person (or the workspace for a
 * room or an unowned thread), and whether it is confidential (its own key,
 * wrapped under the owner's). Null: not known yet (the store is loading);
 * the row is written plain and the migration seals it later. */
export type ContentOwnerResolver = (threadId: string) => { owner: string; confidential: boolean } | null;

export interface ContentEncryptionOptions {
  mode: ContentEncryptionMode;
  /** the key-encryption key; local (the vault key) when absent */
  provider?: KekProvider;
  /** providers that only unwrap keys an earlier configuration wrapped */
  others?: KekProvider[];
  resolveOwner?: ContentOwnerResolver;
  /** Whose key a bot's memory takes (server/encryption/content-at-rest.ts): its owner
   * on an organization server, else the workspace. */
  resolveBotOwner?: (botId: string) => string | null;
  /** background migration on timers (tests drive it by hand) */
  autoMigrate?: boolean;
}

/** SAGAX_CONTENT_ENCRYPTION: on unless it says off (the server default). */
export function contentEncryptionModeFromEnv(env: NodeJS.ProcessEnv = process.env): ContentEncryptionMode {
  return /^(off|0|false|no)$/i.test(env.SAGAX_CONTENT_ENCRYPTION?.trim() ?? "") ? "off" : "on";
}

let configured: ContentEncryptionOptions | null = null;
let ring: ContentKeyring | null = null;
let ownerOf: ContentOwnerResolver = () => ({ owner: WORKSPACE_OWNER, confidential: false });
let botOwnerOf: (botId: string) => string | null = () => WORKSPACE_OWNER;
/** Files and logs sealed outside this database (server/encryption/content-at-rest.ts):
 * told when the settings or a key change, and before an owner's keys go. */
interface AtRestListener {
  changed(): void;
  beforeErase?(owner: string, keyIds: readonly string[]): void;
  /** threads (and bots) whose content takes another key now */
  moved?(threadIds: readonly string[], botIds: readonly string[]): void;
}
const atRestListeners = new Set<AtRestListener>();
/** thread id -> the key its new rows are sealed with */
const bindings = new Map<string, LiveKey>();
interface PendingIndex {
  threadId: string;
  keyId: string;
  sources: ReturnType<typeof indexSourcesOf>;
}
/** rowid -> tokens still to write: indexing runs just after the write, in
 * one batch, so a streamed reply re-indexes once, not per patch. */
const pendingIndex = new Map<number, PendingIndex>();
let indexTimer: ReturnType<typeof setTimeout> | null = null;
let unreadableWarned = false;

/** Unconfigured (a script, a test): the library default is off unless
 * SAGAX_CONTENT_ENCRYPTION=on; sealed rows still read either way. */
function encryptionMode(): ContentEncryptionMode {
  if (configured) return configured.mode;
  return process.env.SAGAX_CONTENT_ENCRYPTION?.trim().toLowerCase() === "on" ? "on" : "off";
}

function keyring(): ContentKeyring {
  if (ring) return ring;
  const local = localKekProvider(() => resolveVaultKey(DATA_DIR));
  const active = configured?.provider ?? local;
  const others = [...(configured?.others ?? []), ...(active.id === "local" ? [] : [local])];
  ring = new ContentKeyring(db, active, others, () => { scheduleMigration(); notifyAtRest(); });
  return ring;
}

/** Called once at startup (server/index.ts) and by tests. */
export function configureContentEncryption(options: ContentEncryptionOptions): void {
  configured = options;
  ring = null;
  bindings.clear();
  if (options.resolveOwner) ownerOf = options.resolveOwner;
  if (options.resolveBotOwner) botOwnerOf = options.resolveBotOwner;
  migration.dirty = true;
  scheduleMigration();
  notifyAtRest();
}

function notifyAtRest(): void {
  for (const listener of atRestListeners) {
    try { listener.changed(); } catch { /* a listener never breaks a key change */ }
  }
}

/** server/encryption/content-at-rest.ts registers itself here. */
export function onContentAtRest(listener: AtRestListener): () => void {
  atRestListeners.add(listener);
  return () => atRestListeners.delete(listener);
}

/** Whether new content is sealed (SAGAX_CONTENT_ENCRYPTION, the server
 * default on). Sealed content reads either way. */
export function contentEncryptionOn(): boolean {
  return encryptionMode() === "on";
}

/** Whether the background migrations run on their own timers. */
export function contentAutoMigrate(): boolean {
  return Boolean(configured) && configured?.autoMigrate !== false;
}

/** The key a thread's content takes (its rows, its event logs); null:
 * write plain (encryption off, owner not known yet, key not available). */
export function contentKeyForThread(threadId: string): LiveKey | null {
  try { return sealingKey(threadId); } catch { return null; }
}

/** The key of an owner (a person or the workspace); null as above. */
export function contentKeyForOwner(owner: string): LiveKey | null {
  if (encryptionMode() !== "on") return null;
  try { return keyring().ownerKey(owner); } catch { return null; }
}

/** The key a bot's memory takes: its owner's (organization server), else
 * the workspace's. */
export function contentKeyForBot(botId: string): LiveKey | null {
  let owner: string | null;
  try { owner = botOwnerOf(botId); } catch { owner = null; }
  return contentKeyForOwner(owner || WORKSPACE_OWNER);
}

/** Whose a thread's content is now (its person, its bot's owner, the
 * workspace). */
export function contentOwnerOfThread(threadId: string): string {
  try { return ownerOf(threadId)?.owner ?? WORKSPACE_OWNER; } catch { return WORKSPACE_OWNER; }
}

/** A key by id: "destroyed" when it no longer exists (its content is
 * erased), null when it exists but is locked on this launch. */
export function contentKeyById(keyId: string): LiveKey | "destroyed" | null {
  try { return keyring().key(keyId); } catch { return null; }
}

export function setContentOwnerResolver(resolve: ContentOwnerResolver): void {
  ownerOf = resolve;
}

/** Unwrap every stored key ahead of the first read: required with an
 * asynchronous provider (Key Vault), harmless locally. */
export async function unlockContentKeys(): Promise<{ unlocked: number; failed: number; rewrapped: number }> {
  db();
  const result = await keyring().unlock();
  if (result.failed) console.warn(`content encryption: ${result.failed} content key(s) could not be unwrapped on this launch`);
  return result;
}

function forgetSealingState(): void {
  ring?.reset();
  bindings.clear();
  pendingIndex.clear();
  pendingMemoryIndex.clear();
  statements.clear();
  migration.cursor = 0;
  migration.phase = "messages";
  migration.dirty = true;
  migrationBackoffMs = MIGRATION_PAUSE_MS;
}

/** The key a thread's new rows are sealed with; null writes them plain
 * (encryption off, owner not known yet, key not available). */
function sealingKey(threadId: string): LiveKey | null {
  if (encryptionMode() !== "on") return null;
  const bound = bindings.get(threadId);
  if (bound) return bound;
  const ringNow = keyring();
  const row = cached("SELECT key_id FROM thread_keys WHERE thread_id = ?").get(threadId) as { key_id: string } | undefined;
  if (row) {
    const key = ringNow.key(row.key_id);
    if (key && key !== "destroyed") {
      bindings.set(threadId, key);
      return key;
    }
    if (!key) return null; // exists, not unwrapped yet
  }
  let owner: ReturnType<ContentOwnerResolver>;
  try { owner = ownerOf(threadId); } catch { owner = null; }
  if (!owner) return null;
  let key: LiveKey | null;
  try { key = owner.confidential ? ringNow.threadKey(owner.owner, threadId) : ringNow.ownerKey(owner.owner); }
  catch { key = null; }
  if (!key) return null;
  cached("INSERT INTO thread_keys (thread_id, key_id) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET key_id = excluded.key_id").run(threadId, key.keyId);
  bindings.set(threadId, key);
  return key;
}

interface RowValues {
  text: string | null;
  json: string;
  sealed: Buffer | null;
  keyId: string | null;
}

function rowValues(threadId: string, message: Message): { values: RowValues; key: LiveKey | null } {
  const full = JSON.stringify(message);
  const key = sealingKey(threadId);
  if (!key) return { values: { text: message.text ?? null, json: full, sealed: null, keyId: null }, key: null };
  return {
    values: { text: null, json: skeletonOf(message, full), sealed: seal(key.dek, full, messageAad(key.keyId, key.owner, threadId, String(message.id))), keyId: key.keyId },
    key,
  };
}

function afterWrite(rowid: number | bigint | undefined, threadId: string, message: Message, key: LiveKey | null): void {
  if (rowid === undefined) return;
  const id = Number(rowid);
  if (!key) {
    pendingIndex.delete(id);
    if (encryptionMode() === "on") migration.plaintext = true;
    return;
  }
  pendingIndex.set(id, { threadId, keyId: key.keyId, sources: indexSourcesOf(message) });
  scheduleIndex(40);
}

/** In the background the queue drains in slices of a few milliseconds, so
 * a burst of writes (an import, the migration) never holds the event loop. */
function scheduleIndex(delay: number): void {
  if (indexTimer) return;
  indexTimer = setTimeout(() => {
    indexTimer = null;
    try { flushContentIndex(INDEX_SLICE_MS); } catch { /* the migration reindexes what has no index row */ }
    if (pendingIndex.size) scheduleIndex(1);
  }, delay);
  indexTimer.unref?.();
}
const INDEX_SLICE_MS = 6;

function writeRow(threadId: string, message: Message): void {
  const { values, key } = rowValues(threadId, message);
  const row = cached(UPSERT_MESSAGE).get(threadId, message.id, message.at, message.role, message.kind, values.text, values.json, values.sealed, values.keyId) as { rowid: number } | undefined;
  afterWrite(row?.rowid, threadId, message, key);
  tellMessageListeners(threadId, message.id);
}

/** Told after a message is written or changed (its id), or after a whole
 * thread is deleted (null). The local semantic index follows the
 * transcripts this way (server/recall/semantic-index.ts). A listener never fails
 * the write that already happened. */
type MessageListener = (threadId: string, messageId: string | null) => void;
const messageListeners = new Set<MessageListener>();
export function onMessageChange(listener: MessageListener): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}
function tellMessageListeners(threadId: string, messageId: string | null): void {
  for (const listener of messageListeners) {
    try { listener(threadId, messageId); } catch { /* never fails a write */ }
  }
}

/** Write the queued blind-index tokens. Runs before every search, recall
 * and backup, so a query never misses a row already written. */
export function flushContentIndex(budgetMs = Infinity): void {
  if (budgetMs === Infinity && indexTimer) { clearTimeout(indexTimer); indexTimer = null; }
  if (!pendingIndex.size || !handle) return;
  const started = performance.now();
  const entries = [...pendingIndex];
  pendingIndex.clear();
  let done = 0;
  transaction(() => {
    const check = cached("SELECT m.key_id, m.at, i.rowid AS indexed FROM messages m LEFT JOIN message_index i ON i.rowid = m.rowid WHERE m.rowid = ?");
    const insert = cached("INSERT INTO messages_sealed_fts (rowid, words, prefixes) VALUES (?, ?, ?)");
    const record = cached("INSERT INTO message_index (rowid, thread_id, at, key_id, words, bloom) VALUES (?, ?, ?, ?, ?, ?)");
    for (const [rowid, entry] of entries) {
      // a background slice stops at its budget; the rest waits for the next
      if (done % 8 === 0 && performance.now() - started > budgetMs) break;
      done++;
      const row = check.get(rowid) as { key_id: string | null; at: number; indexed: number | null } | undefined;
      if (!row || row.key_id !== entry.keyId || row.indexed !== null) continue;
      const key = keyring().key(entry.keyId);
      if (!key || key === "destroyed") continue;
      const columns = indexColumns(key.tokenizer(), entry.sources);
      if (columns?.words) insert.run(rowid, columns.words, columns.prefixes);
      record.run(rowid, entry.threadId, row.at, entry.keyId, columns?.words ? 1 : 0, columns?.bloom ?? null);
    }
  });
  for (const [rowid, entry] of entries.slice(done)) if (!pendingIndex.has(rowid)) pendingIndex.set(rowid, entry);
}

interface StoredRow {
  thread_id?: string;
  id?: string;
  json: string;
  sealed?: Uint8Array | null;
  key_id?: string | null;
}

/** A stored row as the message it holds. Null: its key was destroyed
 * (erased), or the blob does not open here (copied from another row).
 * Throws ContentKeyUnavailable when the key exists but is locked, so a
 * caller never mistakes a locked transcript for an empty one. */
function decodeRow(row: StoredRow, threadId?: string): Message | null {
  if (!row.sealed) return JSON.parse(row.json) as Message;
  const key = keyring().key(row.key_id ?? "");
  if (key === "destroyed") return null;
  if (!key) throw new ContentKeyUnavailable();
  const thread = threadId ?? row.thread_id ?? "";
  const id = row.id ?? (JSON.parse(row.json) as { id?: string }).id ?? "";
  try {
    return JSON.parse(openText(key.dek, row.sealed, messageAad(key.keyId, key.owner, thread, id))) as Message;
  } catch (error) {
    if (!(error instanceof ContentSealError) && !(error instanceof SyntaxError)) throw error;
    if (!unreadableWarned) {
      unreadableWarned = true;
      console.warn("content encryption: a sealed message did not open with its key and was left out (no content logged)");
    }
    return null;
  }
}

const decodeAll = (rows: StoredRow[], threadId?: string): Message[] => {
  const out: Message[] = [];
  for (const row of rows) {
    const message = decodeRow(row, threadId);
    if (message) out.push(message);
  }
  return out;
};

/** The text of a sealed or plain row, for a head or snippet. */
function rowText(row: StoredRow & { text?: string | null }): string | null {
  if (typeof row.text === "string") return row.text;
  if (!row.sealed) return null;
  const message = decodeRow(row);
  return typeof message?.text === "string" ? message.text : null;
}

// A sealed TEXT field: a receipt's result, a queued follow-up's payload.
function sealText(threadId: string | null, domain: string, id: string, value: string): string {
  const key = threadId ? sealingKey(threadId) : workspaceKey();
  if (!key) {
    if (encryptionMode() === "on") migration.plaintext = true;
    return value;
  }
  return sealField(key.keyId, key.dek, value, fieldAad(key.keyId, key.owner, domain, id));
}

function workspaceKey(): LiveKey | null {
  if (encryptionMode() !== "on") return null;
  try { return keyring().ownerKey(WORKSPACE_OWNER); } catch { return null; }
}

/** Null: its key was destroyed. */
function openTextField(domain: string, id: string, value: string): string | null {
  const keyId = sealedFieldKeyId(value);
  if (!keyId) return value;
  const key = keyring().key(keyId);
  if (key === "destroyed") return null;
  if (!key) throw new ContentKeyUnavailable();
  try { return openField(key.dek, value, fieldAad(key.keyId, key.owner, domain, id)); }
  catch { return null; }
}

/** Live keys for the search worker and a workspace backup (in memory only). */
function liveKeyMaterial(): SealedKeyMaterial[] {
  return keyring().liveKeys().map((key) => ({ keyId: key.keyId, owner: key.owner, raw: key.raw }));
}
provideContentKeys((): ExportedContentKey[] => {
  if (!handle) db();
  return keyring().liveKeys().map((key) => ({ keyId: key.keyId, owner: key.owner, threadId: key.threadId, raw: key.raw }));
});

/** Whether any sealed row exists (the blind index then takes part in reads). */
function anySealed(): boolean {
  return Boolean(cached("SELECT 1 FROM content_keys LIMIT 1").get());
}

/** A thread changes key: it turned confidential, or its owner changed. New
 * rows take the new key at once; the migration re-seals the old ones. */
export function contentKeyChanged(threadId: string): void {
  bindings.delete(threadId);
  if (!handle && !existsSync(DB_FILE())) return;
  cached("DELETE FROM thread_keys WHERE thread_id = ?").run(threadId);
  migration.dirty = true;
  scheduleMigration();
  notifyAtRest();
}

/** A thread changed hands (its owner, its bot's owner) or turned
 * confidential: everything of it is re-sealed under its new key NOW, in
 * this call, before anything can be erased: its rows, its queued
 * follow-ups, and (server/encryption/content-at-rest.ts) its event logs, decision rows,
 * attachments and its bots' memory (`botIds`: bots that changed owner). A
 * confidential thread's old key, under its old owner, is destroyed once
 * nothing is sealed under it any more. A key not available right now (Key
 * Vault creating the new owner's) leaves the content in the clear, never
 * under the old owner's key; the migration seals it later. */
export function contentOwnerChanged(threadIds: readonly string[], botIds: readonly string[] = []): void {
  if (!handle && !existsSync(DB_FILE())) {
    for (const threadId of threadIds) bindings.delete(threadId);
    return;
  }
  const ringNow = keyring();
  flushContentIndex();
  const retired: string[] = [];
  for (const threadId of threadIds) {
    // read everything under the old key first
    const rows = db().prepare("SELECT rowid, json, sealed, key_id, id FROM messages WHERE thread_id = ?").all(threadId) as unknown as Array<StoredRow & { rowid: number }>;
    const messages: Array<{ rowid: number; message: Message }> = [];
    for (const row of rows) {
      let message: Message | null;
      try { message = decodeRow(row, threadId); } catch { message = null; }
      if (message) messages.push({ rowid: row.rowid, message });
    }
    const followups: Array<{ rowid: number; id: string; plain: string }> = [];
    for (const row of db().prepare("SELECT rowid AS rowid, id, payload FROM chat_followups WHERE thread_id = ?").all(threadId) as Array<{ rowid: number; id: string; payload: string }>) {
      let plain: string | null;
      try { plain = openTextField("followup", row.id, row.payload); } catch { plain = null; }
      if (plain !== null) followups.push({ rowid: row.rowid, id: row.id, plain });
    }
    // a confidential thread's own key stays readable (in memory) until the end,
    // but no longer answers for the thread: it gets a new one under its new owner
    const own = ringNow.threadKeyId(threadId);
    if (own) {
      db().prepare("UPDATE content_keys SET thread_id = ? WHERE key_id = ?").run(`retired:${own}`, own);
      retired.push(own);
    }
    bindings.delete(threadId);
    db().prepare("DELETE FROM thread_keys WHERE thread_id = ?").run(threadId);
    transaction(() => {
      for (const { rowid, message } of messages) rewriteRow(rowid, threadId, message);
    });
    writeFollowups((connection) => {
      for (const followup of followups) connection.prepare("UPDATE chat_followups SET payload = ? WHERE rowid = ?").run(sealText(threadId, "followup", followup.id, followup.plain), followup.rowid);
    });
  }
  flushContentIndex();
  for (const listener of atRestListeners) {
    try { listener.moved?.(threadIds, botIds); } catch { /* the migration finishes what this could not */ }
  }
  if (retired.length) ringNow.destroyKeys(retired);
  migration.dirty = true;
  scheduleMigration();
  notifyAtRest();
}

/** Cryptographic erasure of a person (Loi 25): their content keys and the
 * confidential-thread keys under them are destroyed, with every row still
 * sealed under one. A thread that is still someone else's (a bot that
 * changed hands) is first re-sealed under its current owner. */
export function eraseContentOwner(owner: string): { keys: number; rows: number } {
  const ringNow = keyring();
  const keyIds = ringNow.ownerKeyIds(owner);
  if (!keyIds.length) return { keys: 0, rows: 0 };
  flushContentIndex();
  // files and logs first: what still belongs to someone else is re-sealed
  // under that key, the rest goes with the key
  for (const listener of atRestListeners) {
    try { listener.beforeErase?.(owner, keyIds); } catch { /* erasure goes on: the key still goes */ }
  }
  const placeholders = keyIds.map(() => "?").join(", ");
  // every thread with something under these keys: rows, a key binding, a queued follow-up
  const threads = new Set((db().prepare(`SELECT DISTINCT thread_id FROM messages WHERE key_id IN (${placeholders}) UNION SELECT thread_id FROM thread_keys WHERE key_id IN (${placeholders})`).all(...keyIds, ...keyIds) as Array<{ thread_id: string }>).map((row) => row.thread_id));
  for (const row of db().prepare("SELECT thread_id, payload FROM chat_followups").all() as Array<{ thread_id: string; payload: string }>) {
    const keyId = sealedFieldKeyId(row.payload);
    if (keyId && keyIds.includes(keyId)) threads.add(row.thread_id);
  }
  // what now belongs to someone else (a thread or a bot that changed hands)
  // is re-sealed under that key first, whole; the rest goes with the key
  const moved = [...threads].filter((threadId) => {
    let current: ReturnType<ContentOwnerResolver>;
    try { current = ownerOf(threadId); } catch { current = null; }
    return Boolean(current && current.owner !== owner);
  });
  if (moved.length) contentOwnerChanged(moved);
  let rows = 0;
  writeFollowups((connection) => {
    connection.exec("PRAGMA secure_delete = ON");
    try {
      rows = Number(connection.prepare(`DELETE FROM messages WHERE key_id IN (${placeholders})`).run(...keyIds).changes);
      connection.prepare(`DELETE FROM memory_files WHERE key_id IN (${placeholders})`).run(...keyIds);
      connection.prepare(`DELETE FROM thread_keys WHERE key_id IN (${placeholders})`).run(...keyIds);
      ringNow.destroyKeys(keyIds);
    } finally { connection.exec("PRAGMA secure_delete = OFF"); }
  });
  for (const [threadId, key] of bindings) if (keyIds.includes(key.keyId)) bindings.delete(threadId);
  checkpointSoon();
  return { keys: keyIds.length, rows };
}

function rewriteRow(rowid: number, threadId: string, message: Message): void {
  const { values, key } = rowValues(threadId, message);
  cached("UPDATE messages SET text = ?, json = ?, sealed = ?, key_id = ? WHERE rowid = ?").run(values.text, values.json, values.sealed, values.keyId, rowid);
  afterWrite(rowid, threadId, message, key);
}

let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
/** Drop the write-ahead log's copies of destroyed keys soon after. */
function checkpointSoon(): void {
  if (checkpointTimer) return;
  checkpointTimer = setTimeout(() => {
    checkpointTimer = null;
    try { handle?.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* readers busy: the next checkpoint takes it */ }
  }, 0);
  checkpointTimer.unref?.();
}

// The migration: small batches on timers, a few milliseconds each, so the
// event loop never waits on it. "on" seals plain rows (and re-seals rows
// whose thread changed key); "off" opens every sealed row back to plain.
// Each batch is one transaction and verifies what it wrote opens again
// before it commits. A pass ends at the last row; a change starts another.
const migration = {
  phase: "messages" as "messages" | "memory" | "followups" | "receipts" | "done",
  cursor: 0,
  dirty: true,
  /** a plain row may remain (encryption on): the search reads plain rows too */
  plaintext: true,
  timer: null as ReturnType<typeof setTimeout> | null,
  /** a plain row was left during this pass (no key yet) */
  passPlain: false,
  sealedThisPass: 0,
  sealed: 0,
  opened: 0,
  failed: 0,
};

/** A few milliseconds of work, then a pause: the migration takes about a
 * sixth of one core while it runs, and never a request's turn. */
const MIGRATION_SLICE_MS = 4;
const MIGRATION_PAUSE_MS = 20;
const MIGRATION_BACKOFF_MAX_MS = 60_000;
let migrationBackoffMs = MIGRATION_PAUSE_MS;
/** Test seam: throw inside a migration transaction to prove the cursor stays put. */
let migrationFault: (() => void) | null = null;
export function setMigrationFaultForTests(fault: (() => void) | null): void {
  migrationFault = fault;
}

function scheduleMigration(delay = migrationBackoffMs): void {
  if (configured?.autoMigrate === false || migration.timer) return;
  if (!configured) return; // scripts and tests that never configured: no timers
  migration.timer = setTimeout(() => {
    migration.timer = null;
    let finished = true;
    try {
      finished = runContentMigration(MIGRATION_SLICE_MS).done;
      migrationBackoffMs = MIGRATION_PAUSE_MS;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`content migration slice failed (${migration.phase}@${migration.cursor}): ${detail}`);
      finished = false;
      migrationBackoffMs = Math.min(Math.max(migrationBackoffMs * 2, MIGRATION_PAUSE_MS * 2), MIGRATION_BACKOFF_MAX_MS);
    }
    if (!finished) scheduleMigration(migrationBackoffMs);
  }, delay);
  migration.timer.unref?.();
}

/** At start, before the server serves anything: what a sealing pass asked
 * for, so neither the plain full-text index nor a free page keeps text
 * from before it. Skipped above
 * `maxBytes` (the next start tries again). Returns how long it took. */
export function vacuumAfterSealing(maxBytes = 1024 ** 3): number | null {
  const database = db();
  if (!(cached("SELECT value FROM content_meta WHERE key = 'vacuum'").get())) return null;
  let size = 0;
  try { size = statSync(DB_FILE()).size; } catch { return null; }
  if (size > maxBytes) return null;
  const started = performance.now();
  flushContentIndex();
  flushMemoryIndex();
  database.exec("DELETE FROM content_meta WHERE key = 'vacuum'");
  database.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')");
  database.exec("INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')");
  database.exec("VACUUM");
  try { database.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* the next checkpoint */ }
  statements.clear();
  return performance.now() - started;
}

export interface ContentMigrationStatus {
  mode: ContentEncryptionMode;
  provider: string;
  done: boolean;
  sealedRows: number;
  plainRows: number;
  keys: number;
}

/** Counts for a status line (a scan: not for a hot path). */
export function contentEncryptionStatus(): ContentMigrationStatus {
  const counts = db().prepare("SELECT SUM(sealed IS NOT NULL) AS sealed, SUM(sealed IS NULL) AS plain FROM messages").get() as { sealed: number | null; plain: number | null };
  return {
    mode: encryptionMode(),
    provider: keyring().providerId,
    done: migration.phase === "done" && !migration.dirty,
    sealedRows: counts.sealed ?? 0,
    plainRows: counts.plain ?? 0,
    keys: keyring().count(),
  };
}

/** One step of the migration: one batch, then more while `budgetMs` lasts
 * (Infinity: to the end). */
export function runContentMigration(budgetMs = 8): { done: boolean } {
  const started = performance.now();
  if (migration.phase === "done") {
    if (!migration.dirty) return { done: true };
    migration.phase = "messages";
    migration.cursor = 0;
  }
  if (migration.cursor === 0 && migration.phase === "messages") {
    migration.dirty = false;
    migration.passPlain = false;
  }
  const on = encryptionMode() === "on";
  const database = db();
  // at least one batch per step, then as many as fit in the budget
  for (let first = true; first || performance.now() - started < budgetMs; first = false) {
    if (migration.phase === "messages") {
      const rows = database.prepare(
        "SELECT m.rowid AS rowid, m.thread_id, m.id, m.json, m.sealed, m.key_id, i.rowid AS indexed, k.key_id AS bound FROM messages m " +
        "LEFT JOIN thread_keys k ON k.thread_id = m.thread_id LEFT JOIN message_index i ON i.rowid = m.rowid WHERE m.rowid > ? ORDER BY m.rowid LIMIT 16",
      ).all(migration.cursor) as unknown as Array<StoredRow & { rowid: number; thread_id: string; id: string; indexed: number | null; bound: string | null }>;
      if (!rows.length) { migration.phase = "memory"; migration.cursor = 0; continue; }
      database.exec("PRAGMA secure_delete = ON");
      try {
        // Cursor advances only after COMMIT. Advancing inside the transaction
        // used to skip a whole slice when SQLITE_BUSY (or similar) rolled it back.
        let advanced = migration.cursor;
        transaction(() => {
          for (const row of rows) {
            // the budget holds per row, not per batch: a slow disk ends the step early
            if (row.rowid !== rows[0]!.rowid && performance.now() - started > budgetMs) break;
            migrationFault?.();
            if (on) {
              if (row.sealed && row.key_id && row.key_id === row.bound) {
                if (row.indexed === null && !pendingIndex.has(row.rowid)) {
                  const message = decodeRow(row, row.thread_id);
                  if (message) afterWrite(row.rowid, row.thread_id, message, bindings.get(row.thread_id) ?? sealingKey(row.thread_id));
                }
                advanced = row.rowid;
                continue;
              }
              let message: Message | null;
              try { message = decodeRow(row, row.thread_id); } catch { migration.passPlain = migration.passPlain || !row.sealed; advanced = row.rowid; continue; }
              if (!message) { advanced = row.rowid; continue; }
              const { values, key } = rowValues(row.thread_id, message);
              if (!key) { migration.passPlain = true; advanced = row.rowid; continue; }
              // verify before it replaces anything: the sealed copy opens to the same message
              const check = openText(key.dek, values.sealed!, messageAad(key.keyId, key.owner, row.thread_id, String(message.id)));
              if (check !== JSON.stringify(message)) { migration.failed++; advanced = row.rowid; continue; }
              cached("UPDATE messages SET text = ?, json = ?, sealed = ?, key_id = ? WHERE rowid = ?").run(values.text, values.json, values.sealed, values.keyId, row.rowid);
              afterWrite(row.rowid, row.thread_id, message, key);
              migration.sealed++;
              migration.sealedThisPass++;
            } else if (row.sealed) {
              let message: Message | null;
              try { message = decodeRow(row, row.thread_id); } catch { migration.failed++; advanced = row.rowid; continue; }
              if (!message) { advanced = row.rowid; continue; }
              cached("UPDATE messages SET text = ?, json = ?, sealed = NULL, key_id = NULL WHERE rowid = ?").run(message.text ?? null, JSON.stringify(message), row.rowid);
              pendingIndex.delete(row.rowid);
              migration.opened++;
            }
            advanced = row.rowid;
          }
        });
        migration.cursor = advanced;
      } finally { database.exec("PRAGMA secure_delete = OFF"); }
      // the tokens of what this step sealed, in what is left of its budget
      if (pendingIndex.size) flushContentIndex(Math.max(1, budgetMs - (performance.now() - started)));
      continue;
    }
    if (migration.phase === "memory") {
      if (pendingMemoryIndex.size) flushMemoryIndex();
      // the memory index (memory_files): sealed under each bot's key, verified
      // before it replaces the plain row, or opened back to plain (off)
      const rows = database.prepare("SELECT rowid AS rowid, bot_id, path, text, sealed, key_id FROM memory_files WHERE rowid > ? ORDER BY rowid LIMIT 16").all(migration.cursor) as Array<{ rowid: number; bot_id: string; path: string; text: string; sealed: Uint8Array | null; key_id: string | null }>;
      if (!rows.length) { migration.phase = "followups"; migration.cursor = 0; continue; }
      database.exec("PRAGMA secure_delete = ON");
      try {
        let advanced = migration.cursor;
        transaction(() => {
          for (const row of rows) {
            migrationFault?.();
            let text: string | null;
            try { text = openMemoryRow(row); } catch { migration.passPlain = migration.passPlain || !row.key_id; advanced = row.rowid; continue; }
            // erased (its key destroyed): the next sync indexes the file again
            if (text === null) { cached("DELETE FROM memory_files WHERE rowid = ?").run(row.rowid); advanced = row.rowid; continue; }
            if (on) {
              const key = contentKeyForBot(row.bot_id);
              if (!key) { if (!row.key_id) migration.passPlain = true; advanced = row.rowid; continue; }
              if (row.key_id === key.keyId) { advanced = row.rowid; continue; }
              const sealed = seal(key.dek, text, memoryRowAad(key, row.bot_id, row.path));
              if (openText(key.dek, sealed, memoryRowAad(key, row.bot_id, row.path)) !== text) { migration.failed++; advanced = row.rowid; continue; }
              cached("UPDATE memory_files SET text = '', sealed = ?, key_id = ? WHERE rowid = ?").run(sealed, key.keyId, row.rowid);
              indexMemoryRow(row.rowid, key, text);
              if (!row.key_id) { migration.sealed++; migration.sealedThisPass++; }
            } else if (row.key_id) {
              cached("UPDATE memory_files SET text = ?, sealed = NULL, key_id = NULL WHERE rowid = ?").run(text, row.rowid);
              migration.opened++;
            }
            advanced = row.rowid;
          }
        });
        migration.cursor = advanced;
      } finally { database.exec("PRAGMA secure_delete = OFF"); }
      continue;
    }
    if (migration.phase === "followups") {
      const rows = database.prepare("SELECT rowid AS rowid, id, thread_id, payload FROM chat_followups WHERE rowid > ? ORDER BY rowid LIMIT 64").all(migration.cursor) as Array<{ rowid: number; id: string; thread_id: string; payload: string }>;
      if (!rows.length) { migration.phase = "receipts"; migration.cursor = 0; continue; }
      let advanced = migration.cursor;
      writeFollowups((connection) => {
        for (const row of rows) {
          migrationFault?.();
          const sealedNow = sealedFieldKeyId(row.payload) !== null;
          if (sealedNow === on) { advanced = row.rowid; continue; }
          const plain = openTextField("followup", row.id, row.payload);
          if (plain === null) { advanced = row.rowid; continue; }
          const next = on ? sealText(row.thread_id, "followup", row.id, plain) : plain;
          if (next !== row.payload) connection.prepare("UPDATE chat_followups SET payload = ? WHERE rowid = ?").run(next, row.rowid);
          advanced = row.rowid;
        }
      });
      migration.cursor = advanced;
      continue;
    }
    if (migration.phase === "receipts") {
      const rows = database.prepare("SELECT rowid AS rowid, kind, key, result FROM command_receipts WHERE rowid > ? ORDER BY rowid LIMIT 64").all(migration.cursor) as Array<{ rowid: number; kind: string; key: string; result: string }>;
      if (!rows.length) {
        // the queued tokens first, a slice per step: never one long flush
        if (pendingIndex.size) {
          flushContentIndex(Math.max(1, budgetMs - (performance.now() - started)));
          if (pendingIndex.size) return { done: false };
        }
        migration.phase = "done";
        migration.cursor = 0;
        migration.plaintext = !on || migration.passPlain;
        // A delete only marks a row gone in the plain full-text index: the
        // words of rows sealed this pass stay in its segments until a merge.
        // Pages written before the pass (a B-tree split, a deleted row) can
        // also hold old plain text in their free space. Both go at the next
        // start, before it serves anything (vacuumAfterSealing: the index
        // rebuilt from the table, where sealed rows have no text, then one
        // VACUUM), never as a pause in a running server.
        if (on && migration.sealedThisPass > 0 && !migration.passPlain) {
          cached("INSERT INTO content_meta (key, value) VALUES ('vacuum', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
          migration.sealedThisPass = 0;
        }
        checkpointSoon();
        return { done: !migration.dirty };
      }
      let advanced = migration.cursor;
      transaction(() => {
        for (const row of rows) {
          migrationFault?.();
          const sealedNow = sealedFieldKeyId(row.result) !== null;
          if (sealedNow === on) { advanced = row.rowid; continue; }
          const id = `${row.kind}\u0000${row.key}`;
          const plain = openTextField("receipt", id, row.result);
          if (plain === null) { advanced = row.rowid; continue; }
          const next = on ? sealText(null, "receipt", id, plain) : plain;
          if (next !== row.result) cached("UPDATE command_receipts SET result = ? WHERE rowid = ?").run(next, row.rowid);
          advanced = row.rowid;
        }
      });
      migration.cursor = advanced;
      continue;
    }
    break;
  }
  return { done: false };
}

export interface FollowupPayload {
  text: string;
  prompt?: string;
  replyToId?: string;
  sendId?: string;
  /** The Data result the words were sent about; the drained line keeps it. */
  dataContext?: Message["dataContext"];
  reason?: SteerQueueReason;
  unattended?: boolean;
  peerAsk?: Message["peerAsk"];
  mode?: "chat" | "goal";
  /** "api": a room line sent through the local API with no session behind
   * it. "call": a person's words relayed from a Live call. "sms": a text
   * the person sent their bot from their own verified number. */
  via?: "api" | "call" | "sms";
  /** Words said on a voice call (Message.voiceCall). */
  voiceCall?: Message["voiceCall"];
  /** The Live call a "call" line was spoken on (Message.callId). Only with
   * `via: "call"`; restore and crash recovery drop it from any other row. */
  callId?: string;
  /** Who queued these words. Absent on the owner's own sends and on every
   * row written before this existed; both read as the profile name. */
  sender?: ResolvedSender;
  /** Who the usage ledger books the turn these words start to. Absent on
   * rows written before this existed. */
  trigger?: UsageTrigger;
  /** A thread a bot opened on itself: where the opener's work started
   * (peer-provenance.ts). Absent is outside. */
  origin?: WorkOrigin;
  /** When the words were queued (epoch ms), so drain-time coalescing can
   * tell a contiguous burst from hours-apart texts. Rows written before
   * this existed read as queued at restore time. */
  queuedAt?: number;
  /** Aside-lane rows (kind "aside"): the peer whose words these are. The
   * prompt carries the non-steering envelope; text stays the raw words. */
  aside?: {
    fromBotId: string;
    fromBotName: string;
    unattended?: boolean;
    /** Comms depth captured when the aside was queued, so a degraded
     * follow-up turn inherits the same one-hop chain limit. */
    commsDepth: number;
  };
}
export type FollowupStatus = "pending" | "dispatching" | "interrupted" | "cancelled";
export interface ChatFollowup {
  id: string;
  kind: "bot" | "channel" | "aside";
  ownerId: string;
  threadId: string;
  status: FollowupStatus;
  payload: FollowupPayload;
}

/** A 202/cancel/dispatch claim must reach disk before publishing its result.
 * Use the existing transcript DB (and backup path), with FULL sync for these
 * small transactions only; ordinary transcript writes keep their policy. */
function writeFollowups(write: (connection: DatabaseSync) => void): void {
  const connection = db();
  connection.exec("PRAGMA synchronous = FULL");
  try {
    connection.exec("BEGIN IMMEDIATE");
    try { write(connection); connection.exec("COMMIT"); }
    catch (error) { connection.exec("ROLLBACK"); throw error; }
  } finally { connection.exec("PRAGMA synchronous = NORMAL"); }
}

export interface StoredCommandReceipt {
  kind: string;
  key: string;
  at: number;
  /** JSON text of the command's result, exactly as first produced. */
  result: string;
}

export function readCommandReceipt(kind: string, key: string): StoredCommandReceipt | null {
  const row = db()
    .prepare("SELECT kind, key, at, result FROM command_receipts WHERE kind = ? AND key = ?")
    .get(kind, key) as StoredCommandReceipt | undefined;
  if (!row) return null;
  const result = openTextField("receipt", `${kind}\u0000${key}`, row.result);
  return result === null ? null : { ...row, result };
}

/** Run `apply` and record its receipt in ONE transaction on the transcript
 * DB, so a command's rows and the proof that it ran land together or not
 * at all. A receipt already present short-circuits: the stored result is
 * returned and `apply` never runs. Everything `apply` writes through this
 * module (insertMessage, setActiveLeaf, ...) joins the same transaction. */
export function withCommandReceipt(
  kind: string,
  key: string,
  apply: () => string,
  at: number,
): { result: string; replayed: boolean } {
  return transaction((database) => {
    const existing = database
      .prepare("SELECT result FROM command_receipts WHERE kind = ? AND key = ?")
      .get(kind, key) as { result: string } | undefined;
    const opened = existing ? openTextField("receipt", `${kind}\u0000${key}`, existing.result) : null;
    if (opened !== null) return { result: opened, replayed: true };
    // a receipt whose key was destroyed proves nothing any more: run again
    if (existing) database.prepare("DELETE FROM command_receipts WHERE kind = ? AND key = ?").run(kind, key);
    const result = apply();
    database
      .prepare("INSERT INTO command_receipts(kind, key, at, result) VALUES (?, ?, ?, ?)")
      .run(kind, key, at, sealText(null, "receipt", `${kind}\u0000${key}`, result));
    return { result, replayed: false };
  });
}

/** Write (or overwrite) one receipt: for a command whose receipt changes
 * state over its life (a "pending" marker written before an external call,
 * then the final result). */
export function putCommandReceipt(kind: string, key: string, result: string, at: number): void {
  db().prepare("INSERT INTO command_receipts(kind, key, at, result) VALUES (?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE SET at = excluded.at, result = excluded.result")
    .run(kind, key, at, sealText(null, "receipt", `${kind}\u0000${key}`, result));
}

export function deleteCommandReceipt(kind: string, key: string): void {
  db().prepare("DELETE FROM command_receipts WHERE kind = ? AND key = ?").run(kind, key);
}

/** Drop the receipts of one kind written before `before` (ms). */
export function purgeCommandReceipts(kind: string, before: number): number {
  return Number(db().prepare("DELETE FROM command_receipts WHERE kind = ? AND at < ?").run(kind, before).changes);
}

export function saveChatFollowup(followup: Omit<ChatFollowup, "status">): void {
  writeFollowups((connection) => connection.prepare(
    "INSERT INTO chat_followups(id, kind, owner_id, thread_id, send_id, status, payload) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  ).run(followup.id, followup.kind, followup.ownerId, followup.threadId, followup.payload.sendId ?? null,
    sealText(followup.threadId, "followup", followup.id, JSON.stringify(followup.payload))));
}

/** Null retires a dispatch whose canonical transcript is already durable.
 * Cancellation tombstones remain so a retried sendId cannot resurrect it. */
export function settleChatFollowups(ids: string[], status: FollowupStatus | null): void {
  if (!ids.length) return;
  writeFollowups((connection) => {
    const statement = connection.prepare(status === null
      ? "DELETE FROM chat_followups WHERE id = ?"
      : status === "cancelled"
        ? "UPDATE chat_followups SET status = ?, payload = '{\"text\":\"\"}' WHERE id = ?"
        : "UPDATE chat_followups SET status = ? WHERE id = ?");
    for (const id of ids) {
      if (status === null) statement.run(id);
      else statement.run(status, id);
    }
  });
}

export function chatFollowups(kind?: ChatFollowup["kind"]): ChatFollowup[] {
  const rows = (kind
    ? db().prepare("SELECT * FROM chat_followups WHERE kind = ? ORDER BY rowid").all(kind)
    : db().prepare("SELECT * FROM chat_followups ORDER BY rowid").all()) as Array<{
      id: string; kind: ChatFollowup["kind"]; owner_id: string; thread_id: string; status: FollowupStatus; payload: string;
    }>;
  const out: ChatFollowup[] = [];
  for (const row of rows) {
    const payload = openTextField("followup", row.id, row.payload);
    if (payload === null) continue; // its key was destroyed: erased with its thread
    out.push({ id: row.id, kind: row.kind, ownerId: row.owner_id, threadId: row.thread_id, status: row.status, payload: JSON.parse(payload) as FollowupPayload });
  }
  return out;
}

export function cancelledChatFollowup(kind: ChatFollowup["kind"], ownerId: string, threadId: string, sendId: string): boolean {
  return Boolean(db().prepare(
    "SELECT 1 FROM chat_followups WHERE kind = ? AND owner_id = ? AND thread_id = ? AND send_id = ? AND status = 'cancelled'",
  ).get(kind, ownerId, threadId, sendId));
}

export interface ThreadRows {
  messages: Message[];
  activeLeafId: string | null;
}

/** Read one thread, importing its legacy JSON file on first touch. */
export function readThread(threadId: string, legacyFile: string): ThreadRows {
  const rows = cached("SELECT json, sealed, key_id, id FROM messages WHERE thread_id = ? ORDER BY rowid")
    .all(threadId) as unknown as StoredRow[];
  if (rows.length) {
    const state = cached("SELECT active_leaf_id FROM thread_state WHERE thread_id = ?")
      .get(threadId) as { active_leaf_id: string | null } | undefined;
    return { messages: decodeAll(rows, threadId), activeLeafId: state?.active_leaf_id ?? null };
  }
  return importLegacy(threadId, legacyFile);
}

export interface ThreadTailRows extends ThreadRows {
  /** `true` means older rows exist beyond this page; `false` means the SQL
   * read returned the complete thread. Absent for a full legacy import.
   * Both false and absent results can be cached as a full load. */
  hasMore?: boolean;
}

/** The newest `limit` rows only, read at the SQL boundary — the fast path
 * for a display page (startup hydrate, a fresh scrollback view) that never
 * needs the rest of a long transcript. Falls back to a full legacy import
 * on first touch, same as readThread(); that read is a one-time migration
 * cost regardless of how much of the result the caller keeps. */
export function readThreadTail(threadId: string, legacyFile: string, limit: number): ThreadTailRows {
  const rows = cached("SELECT json, sealed, key_id, id FROM messages WHERE thread_id = ? ORDER BY rowid DESC LIMIT ?")
    .all(threadId, limit + 1) as unknown as StoredRow[];
  if (rows.length) {
    const hasMore = rows.length > limit;
    if (hasMore) rows.length = limit;
    rows.reverse();
    const state = cached("SELECT active_leaf_id FROM thread_state WHERE thread_id = ?")
      .get(threadId) as { active_leaf_id: string | null } | undefined;
    return { messages: decodeAll(rows, threadId), activeLeafId: state?.active_leaf_id ?? null, hasMore };
  }
  return importLegacy(threadId, legacyFile);
}

function importLegacy(threadId: string, legacyFile: string): ThreadRows {
  let messages: Message[] = [];
  let activeLeafId: string | null = null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(legacyFile, "utf8"));
  } catch {
    return { messages, activeLeafId }; // fresh thread
  }
  if (Array.isArray(raw)) messages = raw as Message[]; // pre-branching flat file
  else if (raw && typeof raw === "object") {
    messages = ((raw as { messages?: Message[] }).messages ?? []) as Message[];
    activeLeafId = (raw as { activeLeafId?: string | null }).activeLeafId ?? null;
  }
  db().exec("BEGIN");
  try {
    for (const message of messages) writeRow(threadId, message);
    setActiveLeaf(threadId, activeLeafId);
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
  // left beside the DB as a one-time backup, renamed so the import never
  // runs twice against a thread whose rows were later deleted
  try {
    renameSync(legacyFile, `${legacyFile}.imported`);
    try {
      chmodSync(`${legacyFile}.imported`, 0o600);
    } catch {}
  } catch {}
  return { messages, activeLeafId };
}

export function insertMessage(threadId: string, message: Message): void {
  writeRow(threadId, message);
}

/** A backup may only populate a fresh thread, never replace a transcript. */
export function importThread(threadId: string, messages: Message[], activeLeafId: string | null): void {
  transaction((database) => {
    if (database.prepare("SELECT 1 FROM messages WHERE thread_id = ? LIMIT 1").get(threadId) ||
        database.prepare("SELECT 1 FROM thread_state WHERE thread_id = ?").get(threadId)) {
      throw new Error("Cannot import over an existing conversation");
    }
    for (const message of messages) insertMessage(threadId, message);
    setActiveLeaf(threadId, activeLeafId);
  });
}

/** Persist a new message and the branch head as one crash-safe mutation. */
export function appendMessage(threadId: string, message: Message): void {
  transaction(() => {
    insertMessage(threadId, message);
    setActiveLeaf(threadId, message.id);
  });
}

export function updateMessage(threadId: string, message: Message): void {
  const { values, key } = rowValues(threadId, message);
  const row = cached("UPDATE messages SET at = ?, role = ?, kind = ?, text = ?, json = ?, sealed = ?, key_id = ? WHERE thread_id = ? AND id = ? RETURNING rowid")
    .get(message.at, message.role, message.kind, values.text, values.json, values.sealed, values.keyId, threadId, message.id) as { rowid: number } | undefined;
  afterWrite(row?.rowid, threadId, message, key);
  tellMessageListeners(threadId, message.id);
}

/** Goal cards are new SQLite-backed messages, so crash recovery can locate
 * the tiny set of unfinished receipts without eagerly loading every room
 * transcript into memory at startup. */
export function workingGoalRunMessages(): Array<{ threadId: string; message: Message }> {
  const rows = db()
    .prepare(
      "SELECT thread_id, id, json, sealed, key_id FROM messages " +
      "WHERE kind = 'goal.run' AND json_extract(json, '$.goalRun.status') = 'working'",
    )
    .all() as unknown as Array<StoredRow & { thread_id: string }>;
  return decodedWithThread(rows);
}

/** Approval cards still open in storage. Their live request (engine
 * process, gate broker hold) is memory-only, so after a restart nothing can
 * deliver an answer to them: startup expires them (server/approvals/approval-restart.ts). */
export function openApprovalCardMessages(): Array<{ threadId: string; message: Message }> {
  const rows = db()
    .prepare(
      "SELECT thread_id, id, json, sealed, key_id FROM messages " +
      "WHERE json_extract(json, '$.card.requestType') = 'permission' " +
      "AND json_extract(json, '$.card.requestId') IS NOT NULL " +
      "AND json_extract(json, '$.card.answered') IS NULL " +
      "AND COALESCE(json_extract(json, '$.card.dismissed'), 0) = 0 " +
      "AND COALESCE(json_extract(json, '$.card.expired'), 0) = 0",
    )
    .all() as unknown as Array<StoredRow & { thread_id: string }>;
  return decodedWithThread(rows);
}

/** Every open inbox card (permission, question, request): still waiting on
 * the person, with a requestId. Used by the age-based pending expiry policy
 * (#1940), which covers every kind list_pending_approvals lists. */
export function openPendingInboxCards(): Array<{ threadId: string; message: Message }> {
  const rows = db()
    .prepare(
      "SELECT thread_id, id, json, sealed, key_id FROM messages " +
      "WHERE json_extract(json, '$.card.requestId') IS NOT NULL " +
      "AND json_extract(json, '$.card.answered') IS NULL " +
      "AND COALESCE(json_extract(json, '$.card.dismissed'), 0) = 0 " +
      "AND COALESCE(json_extract(json, '$.card.expired'), 0) = 0",
    )
    .all() as unknown as Array<StoredRow & { thread_id: string }>;
  return decodedWithThread(rows);
}

function decodedWithThread(rows: Array<StoredRow & { thread_id: string }>): Array<{ threadId: string; message: Message }> {
  const out: Array<{ threadId: string; message: Message }> = [];
  for (const row of rows) {
    const message = decodeRow(row, row.thread_id);
    if (message) out.push({ threadId: row.thread_id, message });
  }
  return out;
}

export function setActiveLeaf(threadId: string, leafId: string | null): void {
  db()
    .prepare(
      "INSERT INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?) " +
        "ON CONFLICT(thread_id) DO UPDATE SET active_leaf_id = excluded.active_leaf_id",
    )
    .run(threadId, leafId);
}

/** Newest message timestamp per thread. One grouped read, chunked under
 * SQLite's variable limit. Threads with no rows are absent. */
export function latestMessageAts(threadIds: readonly string[]): Map<string, number> {
  return newestAts(threadIds, "");
}

/** Newest line a person sent from an app, per thread: a user line with the
 * sendId every client send carries (a routine's or a webhook's prompt has
 * none) that no bot delivered (peerAsk) and no other interface relayed.
 * Threads without one are absent. */
export function latestPersonLineAts(threadIds: readonly string[]): Map<string, number> {
  return newestAts(threadIds, "AND role = 'user' AND kind = 'text' AND json_extract(json, '$.sendId') IS NOT NULL " +
    "AND json_extract(json, '$.peerAsk') IS NULL AND json_extract(json, '$.relayed') IS NULL");
}

/** MAX(at) per thread over the rows `where` keeps, as latestMessageAts reads it. */
function newestAts(threadIds: readonly string[], where: string): Map<string, number> {
  const ids = [...new Set(threadIds.filter((id) => id.length > 0))];
  const out = new Map<string, number>();
  const chunk = 400;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const placeholders = slice.map(() => "?").join(", ");
    const rows = db()
      .prepare(`SELECT thread_id, MAX(at) AS at FROM messages WHERE thread_id IN (${placeholders}) ${where} GROUP BY thread_id`)
      .all(...slice) as Array<{ thread_id: string; at: number }>;
    for (const row of rows) {
      if (typeof row.at === "number" && Number.isFinite(row.at)) out.set(row.thread_id, row.at);
    }
  }
  return out;
}

/** One transaction; `beforeCommit` throwing keeps the thread's rows. */
export function deleteThread(threadId: string, beforeCommit?: () => void): void {
  writeFollowups((connection) => {
    connection.prepare("DELETE FROM chat_followups WHERE thread_id = ?").run(threadId);
    connection.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
    connection.prepare("DELETE FROM thread_state WHERE thread_id = ?").run(threadId);
    connection.prepare("DELETE FROM thread_reads WHERE thread_id = ?").run(threadId);
    // its idempotency receipts (digest.append, digest.files, hook.ingest,
    // compaction.append), keyed "<thread>:<turn>...": copies of its digest
    // and compaction rows. A key range, so no other thread's id matches.
    connection.prepare("DELETE FROM command_receipts WHERE key >= ? AND key < ?").run(`${threadId}:`, `${threadId};`);
    // its key binding, and a confidential thread's own key: destroyed, so
    // nothing sealed under it opens again (cryptographic erasure)
    connection.prepare("DELETE FROM thread_keys WHERE thread_id = ?").run(threadId);
    const own = keyring().threadKeyId(threadId);
    if (own) keyring().destroyKeys([own]);
    beforeCommit?.();
  });
  bindings.delete(threadId);
  for (const [rowid, entry] of pendingIndex) if (entry.threadId === threadId) pendingIndex.delete(rowid);
  checkpointSoon();
  tellMessageListeners(threadId, null);
}

/** Read positions of one thread (server/messages/read-receipts.ts): participant id
 * to the newest message they have seen. A thread with no rows has none. */
export function readThreadReads(threadId: string): Record<string, { messageId: string; at: number }> {
  const rows = db()
    .prepare("SELECT participant_id, message_id, at FROM thread_reads WHERE thread_id = ?")
    .all(threadId) as Array<{ participant_id: string; message_id: string; at: number }>;
  const out: Record<string, { messageId: string; at: number }> = {};
  for (const row of rows) out[row.participant_id] = { messageId: row.message_id, at: row.at };
  return out;
}

export function writeThreadRead(threadId: string, participantId: string, messageId: string, at: number): void {
  db()
    .prepare(
      "INSERT INTO thread_reads (thread_id, participant_id, message_id, at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(thread_id, participant_id) DO UPDATE SET message_id = excluded.message_id, at = excluded.at",
    )
    .run(threadId, participantId, messageId, at);
}

/** Every thread whose stored messages mention `fragment` anywhere (an
 * attachment's file name, say). A scan, like search; used only to decide
 * whether a member on a workspace with a restricted bot may fetch a file. */
export function threadsReferencing(fragment: string): string[] {
  if (!fragment) return [];
  const rows = db().prepare("SELECT DISTINCT thread_id FROM messages WHERE instr(json, ?) > 0").all(fragment) as Array<{ thread_id: string }>;
  return rows.map((row) => row.thread_id);
}

/** 2026-11-03 (audit S-5): threadsReferencing for many fragments at once,
 * one pass over messages in the search worker, never on the server's thread. */
export function threadsReferencingAsync(fragments: readonly string[]): Promise<Map<string, string[]>> {
  if (!fragments.some((fragment) => fragment.length > 0)) return Promise.resolve(new Map());
  db(); // the owner initializes/migrates the schema before any read-only scan
  searchWorker ??= new MessageSearchWorker(DB_FILE());
  return searchWorker.references(fragments);
}

/** Case-insensitive substring search over text messages, newest first.
 * Keep literal substring semantics; HTTP callers run the scan off-thread. */
export function searchMessages(query: string, limit = 40, threadId?: string): SearchHit[] {
  db();
  flushContentIndex();
  const sealed = anySealed() ? { keys: keyring().liveKeys(), plaintext: plaintextMayRemain() } : undefined;
  return searchMessagesInDatabase(db(), query, limit, threadId, sealed);
}

/** Whether the plaintext scan must still run: encryption off, or a plain
 * row may be left (the migration has not finished a pass without one). */
function plaintextMayRemain(): boolean {
  return encryptionMode() !== "on" || migration.plaintext || migration.phase !== "done";
}

export function searchMessagesAsync(query: string, limit = 40, threadId?: string): Promise<SearchHit[]> {
  if (!query.trim()) return Promise.resolve([]);
  db(); // The owner initializes/migrates the schema before any read-only scan.
  flushContentIndex(); // the worker reads committed rows: tokens first
  searchWorker ??= new MessageSearchWorker(DB_FILE());
  return searchWorker.search(query, limit, threadId, anySealed() ? { keys: liveKeyMaterial(), plaintext: plaintextMayRemain() } : undefined);
}

export interface RecallHit {
  threadId: string;
  messageId: string;
  at: number;
  role: string;
  /** "digest" for a work-digest row; absent for ordinary text. */
  kind?: "digest";
  /** the matched text, with each matched term wrapped in [brackets] */
  snippet: string;
  /** room messages: which member said it */
  from?: string;
  /** a user-role line another bot delivered with ask_bot: that bot's name.
   * The stored text opens with a note saying so, but the snippet windows
   * around the match and drops it, so the reader learns it here. */
  peer?: string;
}

/** Who wrote a user-role line that reads as the user's. The structural
 * field wins; rows stored before it existed still open with the note. */
function peerAuthor(peerName: string | null, text: string): string | null {
  return peerName ?? peerProvenanceAuthor(text);
}

/** Enough of a line to see whether it opens with an ask_bot note — the
 * note's fixed wording plus a bot name — without reading the whole text. */
const PEER_NOTE_HEAD_CHARS = 160;

// Every query token must match, so a function word the model happened to
// include ("archive reference on") turns a good query into a miss. Drop
// the common ones; if that empties the query, search for what was sent.
const STOP_WORDS = new Set(
  "a an and are as at be by did do for from had has have how i in is it its of on or that the this to was we were what when where which who why with you your".split(" "),
);

/** Turn free text into an FTS5 query that cannot be misparsed: every
 * whitespace-separated token becomes a quoted string, so `AND`, `NOT`,
 * `*`, `:`, and stray quotes are searched for rather than interpreted.
 * Tokens are ANDed — FTS5's default — so a hit contains all of them. */
function ftsQuery(query: string, mode: SearchMode = "all"): string | null {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/"/g, "").trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  const content = tokens.filter((token) => !STOP_WORDS.has(token.toLowerCase()));
  if (mode === "any") {
    // Automatic recall searches with a whole message: any content word may
    // match, ranked by bm25. Punctuation-only tokens are dropped, since a
    // lone "?" or "—" would match nothing useful. No content word, no query.
    const terms = recallTerms(query).map(recallMatchTerm).filter(Boolean);
    return terms.length ? terms.join(" OR ") : null;
  }
  return (content.length ? content : tokens).map((token) => `"${token}"`).join(" ");
}

/** One recall term as FTS5 syntax. The index does no stemming, so a word
 * of four or more letters matches as a prefix, with a plural -s taken off
 * first: "restaurant" and "restaurants" find each other. Skip punctuation
 * terms: unicode61 cannot distinguish "-10" from "10" or "c++" from "c",
 * even in a quoted FTS phrase. Explicit all-term search stays unchanged. */
export function recallMatchTerm(term: string): string | null {
  if (!/^[\p{L}\p{N}]+$/u.test(term)) return null;
  if (!/^\p{L}{4,}$/u.test(term)) return `"${term}"`;
  const stem = term.length > 4 && term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term;
  return `"${stem}"*`;
}

/** "all": every word must match (session_search). "any": one is enough (automatic recall). */
export type SearchMode = "all" | "any";

/** Words that go at the end of a question and say nothing about its topic. */
const RECALL_FILLER = new Set(
  "about again also any anything can could does don't know me my please remember remind should tell there they us would hi hello hey thanks thank ok okay yes yeah no i'm im i've i'll i'd you're quick just".split(" "),
);

/** The content words of a message, for an any-term recall: lower-cased,
 * de-duplicated, stop words and filler dropped. Ordinary separators between
 * letters split words; signs, language symbols and versions (`-10`, `c++`,
 * `v2.1`) survive as written rather than matching a different fact. */
export function recallTerms(query: string): string[] {
  const out: string[] = [];
  for (const raw of query.split(/\s+|(?<=\p{L})[/,;:.—–-]+(?=\p{L})/u)) {
    const token = raw.replace(/"/g, "").replace(/^[\s.,;:!?()[\]{}'`“”‘’]+|[\s.,;:!?()[\]{}'`“”‘’]+$/g, "").toLowerCase();
    if (token.length < 2 && !/\d/.test(token)) continue;
    if (!/[\p{L}\p{N}]/u.test(token)) continue;
    if (STOP_WORDS.has(token) || RECALL_FILLER.has(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out.slice(0, 16);
}

/** A row with text: a plain one's column, a sealed one's projection flag. */
const HAS_TEXT = "(text IS NOT NULL OR (sealed IS NOT NULL AND json_extract(json, '$.hasText') = 1))";
const HAS_TEXT_M = "(m.text IS NOT NULL OR (m.sealed IS NOT NULL AND json_extract(m.json, '$.hasText') = 1))";

/** How much of a matched message rides back in a hit. Wide enough that a
 * short report reads whole; a longer one is fetched with readMessageText. */
const SNIPPET_TOKENS = 48;

/** The newest text message of a thread, for a session_read that names only
 * the thread (#2748: the last report of an earlier run). */
export function readLatestMessageText(threadId: string): ReturnType<typeof readMessageText> {
  const row = db()
    .prepare(`SELECT id FROM messages WHERE thread_id = ? AND kind = 'text' AND ${HAS_TEXT} ORDER BY at DESC, rowid DESC LIMIT 1`)
    .get(threadId) as { id: string } | undefined;
  return row ? readMessageText(threadId, row.id) : null;
}

/** Full text of one text message, for a session_read after a search hit.
 * Null for a missing row or a non-text kind (activity chips carry no
 * transcript text). */
export function readMessageText(
  threadId: string,
  messageId: string,
): { threadId: string; messageId: string; at: number; role: string; text: string; from?: string; peer?: string; webhook?: true } | null {
  const row = db()
    .prepare(
      "SELECT id, at, role, text, json, sealed, key_id, json_extract(json, '$.from.name') AS from_name, " +
        "json_extract(json, '$.peerAsk.name') AS peer_name, json_extract(json, '$.webhookPost') AS webhook_post FROM messages " +
        `WHERE thread_id = ? AND id = ? AND kind = 'text' AND ${HAS_TEXT}`,
    )
    .get(threadId, messageId) as
    | (StoredRow & { at: number; role: string; text: string | null; from_name: string | null; peer_name: string | null; webhook_post: number | null })
    | undefined;
  if (!row) return null;
  const text = rowText({ ...row, thread_id: threadId });
  if (text === null) return null;
  const peer = peerAuthor(row.peer_name, text);
  return {
    threadId,
    messageId,
    at: row.at,
    role: row.role,
    text,
    ...(row.webhook_post ? { from: WEBHOOK_AUTHOR, webhook: true as const } : row.from_name ? { from: row.from_name } : {}),
    ...(peer ? { peer } : {}),
  };
}

/** A text message as the local semantic index reads it (opened when sealed). */
export interface IndexableMessage {
  rowid: number;
  messageId: string;
  at: number;
  text: string;
}

/** The text messages of one thread after a rowid, oldest first, opened.
 * A row whose key was destroyed is skipped (erased). A row whose key is
 * locked on this launch stops the read before it (`blocked`), so it is
 * read again once the key is back. */
export function textMessagesAfter(threadId: string, afterRowid: number, limit: number): { messages: IndexableMessage[]; last: number; blocked: boolean } {
  const rows = db()
    .prepare(`SELECT rowid, id, at, text, json, sealed, key_id FROM messages WHERE thread_id = ? AND rowid > ? AND kind = 'text' AND ${HAS_TEXT} ORDER BY rowid LIMIT ?`)
    .all(threadId, afterRowid, limit) as unknown as Array<StoredRow & { rowid: number; id: string; at: number; text: string | null }>;
  const messages: IndexableMessage[] = [];
  let last = afterRowid;
  for (const row of rows) {
    let text: string | null;
    try {
      text = rowText({ ...row, thread_id: threadId });
    } catch {
      return { messages, last, blocked: true };
    }
    last = row.rowid;
    if (text && text.trim()) messages.push({ rowid: row.rowid, messageId: row.id, at: row.at, text });
  }
  return { messages, last, blocked: false };
}

/** Every thread that has at least one message. */
export function messageThreadIds(): string[] {
  return (db().prepare("SELECT DISTINCT thread_id FROM messages").all() as Array<{ thread_id: string }>).map((row) => row.thread_id);
}

/** Relevance-ranked recall over the text messages of the given threads:
 * the bot's own past conversations, best match first, not newest first.
 * bm25 rank from FTS5; the snippet is FTS5's own, windowed around the
 * matched terms. Scoping happens in SQL before LIMIT, so a busy thread
 * cannot crowd out a quieter one. */
/** An optional time window on a recall: milliseconds since the epoch. */
export interface RecallRange {
  since?: number;
  until?: number;
}

function rangeClause(range: RecallRange | undefined, column: string): { sql: string; params: number[] } {
  const parts: string[] = [];
  const params: number[] = [];
  if (range?.since !== undefined) {
    parts.push(`${column} >= ?`);
    params.push(range.since);
  }
  if (range?.until !== undefined) {
    parts.push(`${column} <= ?`);
    params.push(range.until);
  }
  return { sql: parts.map((part) => ` AND ${part}`).join(""), params };
}

export function recallMessages(query: string, threadIds: readonly string[], limit = 12, range?: RecallRange, mode: SearchMode = "all"): RecallHit[] {
  const match = ftsQuery(query, mode);
  if (!match || !threadIds.length) return [];
  db();
  const plain = plainRecall(match, threadIds, limit, range);
  if (!anySealed()) return plain.map(unscored);
  flushContentIndex();
  const hidden = sealedRecall(query, threadIds, limit, range, mode);
  if (!hidden.length) return plain.map(unscored);
  // the plain and sealed halves rank by the same rule: text before digest,
  // then bm25, then newest (two indexes: comparable, not identical scores)
  return [...plain, ...hidden]
    .sort((a, b) => Number(a.digest) - Number(b.digest) || a.score - b.score || b.at - a.at)
    .slice(0, limit)
    .map(unscored);
}

type ScoredRecallHit = RecallHit & { score: number; digest: boolean };
const unscored = ({ score: _score, digest: _digest, ...hit }: ScoredRecallHit): RecallHit => hit;

/** The recall terms ftsQuery would send, for the blind index. */
function blindRecallTerms(query: string, mode: SearchMode): RecallTerm[] {
  if (mode === "any") {
    const terms = recallTerms(query).filter((term) => recallMatchTerm(term) !== null);
    return recallTermsFor(terms.map((term) => {
      if (!/^\p{L}{4,}$/u.test(term)) return term;
      return term.length > 4 && term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term;
    }), (term) => /^\p{L}{4,}$/u.test(term));
  }
  const tokens = query.split(/\s+/).map((token) => token.replace(/"/g, "").trim()).filter(Boolean);
  const content = tokens.filter((token) => !STOP_WORDS.has(token.toLowerCase()));
  return recallTermsFor(content.length ? content : tokens, () => false);
}

/** Recall over sealed rows: the blind index ranks (bm25 over keyed words),
 * the snippet is cut from the opened text. */
function sealedRecall(query: string, threadIds: readonly string[], limit: number, range: RecallRange | undefined, mode: SearchMode): ScoredRecallHit[] {
  const terms = blindRecallTerms(query, mode);
  const placeholders = threadIds.map(() => "?").join(", ");
  // the threads' bound keys (a row still under an older key, between a key
  // change and its re-seal, joins the recall once the migration reaches it)
  const keyIds = new Set((db().prepare(`SELECT DISTINCT key_id FROM thread_keys WHERE thread_id IN (${placeholders})`).all(...threadIds) as Array<{ key_id: string }>).map((row) => row.key_id));
  const keys = [...keyIds].map((id) => keyring().key(id)).filter((key): key is LiveKey => Boolean(key) && key !== "destroyed");
  const match = recallMatch(keys.map((key) => key.tokenizer()), terms, mode);
  if (!match) return [];
  const window = rangeClause(range, "m.at");
  const rows = db()
    .prepare(
      "SELECT m.thread_id, m.id, m.at, m.role, m.kind, m.json, m.sealed, m.key_id, json_extract(m.json, '$.from.name') AS from_name, " +
        "json_extract(m.json, '$.peerAsk.name') AS peer_name, json_extract(m.json, '$.webhookPost') AS webhook_post, " +
        "bm25(messages_sealed_fts, 1.0, 0.5) AS score " +
        "FROM messages_sealed_fts JOIN messages m ON m.rowid = messages_sealed_fts.rowid " +
        `WHERE messages_sealed_fts MATCH ? AND m.kind IN ('text', 'digest') AND m.thread_id IN (${placeholders})${window.sql} ` +
        "ORDER BY (m.kind = 'digest'), score, m.at DESC LIMIT ?",
    )
    // a superset (four-letter prefixes): read more, keep what the text holds
    .all(match, ...threadIds, ...window.params, limit * 4) as unknown as Array<StoredRow & {
    thread_id: string; id: string; at: number; role: string; kind: string;
    from_name: string | null; peer_name: string | null; webhook_post: number | null; score: number;
  }>;
  const out: ScoredRecallHit[] = [];
  for (const row of rows) {
    const text = rowText(row);
    if (text === null || !recallHolds(text, terms, mode)) continue;
    if (out.length >= limit) break;
    const peer = peerAuthor(row.peer_name, text.slice(0, PEER_NOTE_HEAD_CHARS));
    out.push({
      threadId: row.thread_id,
      messageId: row.id,
      at: row.at,
      role: row.role,
      ...(row.kind === "digest" ? { kind: "digest" as const } : {}),
      snippet: blindSnippet(text, terms, SNIPPET_TOKENS).replace(/\s+/g, " ").trim(),
      ...(row.webhook_post ? { from: WEBHOOK_AUTHOR } : row.from_name ? { from: row.from_name } : {}),
      ...(peer ? { peer } : {}),
      score: row.score,
      digest: row.kind === "digest",
    });
  }
  return out;
}

function plainRecall(match: string, threadIds: readonly string[], limit: number, range: RecallRange | undefined): ScoredRecallHit[] {
  const placeholders = threadIds.map(() => "?").join(", ");
  const window = rangeClause(range, "m.at");
  const rows = db()
    .prepare(
      "SELECT m.thread_id, m.id, m.at, m.role, m.kind, json_extract(m.json, '$.from.name') AS from_name, " +
        `json_extract(m.json, '$.peerAsk.name') AS peer_name, json_extract(m.json, '$.webhookPost') AS webhook_post, substr(m.text, 1, ${PEER_NOTE_HEAD_CHARS}) AS head, ` +
        `snippet(messages_fts, 0, '[', ']', '…', ${SNIPPET_TOKENS}) AS snippet, bm25(messages_fts) AS score ` +
        "FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid " +
        `WHERE messages_fts MATCH ? AND m.kind IN ('text', 'digest') AND m.thread_id IN (${placeholders})${window.sql} ` +
        // a digest is a record of work, not something anyone said: it ranks
        // after every text hit so recall reads like a conversation first
        "ORDER BY (m.kind = 'digest'), bm25(messages_fts), m.at DESC LIMIT ?",
    )
    .all(match, ...threadIds, ...window.params, limit) as Array<{
    thread_id: string;
    id: string;
    at: number;
    role: string;
    kind: string;
    from_name: string | null;
    peer_name: string | null;
    webhook_post: number | null;
    head: string;
    snippet: string;
    score: number;
  }>;
  return rows.map((row) => {
    const peer = peerAuthor(row.peer_name, row.head);
    return {
      threadId: row.thread_id,
      messageId: row.id,
      at: row.at,
      role: row.role,
      ...(row.kind === "digest" ? { kind: "digest" as const } : {}),
      snippet: row.snippet.replace(/\s+/g, " ").trim(),
      score: row.score,
      digest: row.kind === "digest",
      ...(row.webhook_post ? { from: WEBHOOK_AUTHOR } : row.from_name ? { from: row.from_name } : {}),
      ...(peer ? { peer } : {}),
    };
  });
}

/** Characters of a message shown when a recall is by time, not by words:
 * enough to know what was said, never the whole message. */
const RECENT_HEAD_CHARS = 240;

/** The text messages of the given threads inside a time window, newest
 * first — "what happened since yesterday" needs no words to match. Same
 * shape as a ranked hit, with the head of the message standing in for the
 * FTS snippet. */
export function recentMessages(threadIds: readonly string[], range: RecallRange, limit = 12): RecallHit[] {
  if (!threadIds.length) return [];
  const placeholders = threadIds.map(() => "?").join(", ");
  const window = rangeClause(range, "m.at");
  const rows = db()
    .prepare(
      "SELECT m.thread_id, m.id, m.at, m.role, m.json, m.sealed, m.key_id, json_extract(m.json, '$.from.name') AS from_name, " +
        `json_extract(m.json, '$.peerAsk.name') AS peer_name, json_extract(m.json, '$.webhookPost') AS webhook_post, substr(m.text, 1, ${Math.max(PEER_NOTE_HEAD_CHARS, RECENT_HEAD_CHARS)}) AS head ` +
        `FROM messages m WHERE m.kind = 'text' AND ${HAS_TEXT_M} AND m.thread_id IN (${placeholders})${window.sql} ` +
        "ORDER BY m.at DESC LIMIT ?",
    )
    .all(...threadIds, ...window.params, limit) as unknown as Array<StoredRow & {
    thread_id: string;
    id: string;
    at: number;
    role: string;
    from_name: string | null;
    peer_name: string | null;
    webhook_post: number | null;
    head: string | null;
  }>;
  return rows.flatMap((row) => {
    const head = row.head ?? rowText(row)?.slice(0, Math.max(PEER_NOTE_HEAD_CHARS, RECENT_HEAD_CHARS)) ?? null;
    if (head === null) return [];
    const peer = peerAuthor(row.peer_name, head);
    const folded = head.replace(/\s+/g, " ").trim();
    return {
      threadId: row.thread_id,
      messageId: row.id,
      at: row.at,
      role: row.role,
      snippet: folded.length > RECENT_HEAD_CHARS ? `${folded.slice(0, RECENT_HEAD_CHARS)}…` : folded,
      ...(row.webhook_post ? { from: WEBHOOK_AUTHOR } : row.from_name ? { from: row.from_name } : {}),
      ...(peer ? { peer } : {}),
    };
  });
}

/** The newest thing one bot said in a thread. */
export interface ThreadLatest {
  threadId: string;
  messageId: string;
  at: number;
  /** the head of that message, whitespace folded */
  head: string;
}

/** For each of the given threads, the newest text message the bot itself
 * said there since `since` — one row per thread, newest thread first. A
 * room line carries from.botId; a 1:1 line carries none and is the bot's
 * by construction. What a bot last said in a conversation is the shortest
 * honest answer to "what have you been doing there". */
export function latestSaidByBot(threadIds: readonly string[], botId: string, since: number, limit = 20): ThreadLatest[] {
  if (!threadIds.length) return [];
  const placeholders = threadIds.map(() => "?").join(", ");
  const rows = db()
    .prepare(
      "SELECT thread_id, id, at, head, json, sealed, key_id FROM (" +
        "SELECT m.thread_id, m.id, m.at, substr(m.text, 1, 400) AS head, m.json, m.sealed, m.key_id, " +
        "ROW_NUMBER() OVER (PARTITION BY m.thread_id ORDER BY m.at DESC) AS rn " +
        "FROM messages m " +
        `WHERE m.kind = 'text' AND m.role = 'bot' AND ${HAS_TEXT_M} AND m.at >= ? AND m.thread_id IN (${placeholders}) ` +
        "AND (json_extract(m.json, '$.from.botId') IS NULL OR json_extract(m.json, '$.from.botId') = ?)" +
        ") WHERE rn = 1 ORDER BY at DESC LIMIT ?",
    )
    .all(since, ...threadIds, botId, limit) as unknown as Array<StoredRow & { thread_id: string; id: string; at: number; head: string | null }>;
  return rows.flatMap((row) => {
    const head = row.head ?? rowText(row)?.slice(0, 400) ?? null;
    return head === null ? [] : [{ threadId: row.thread_id, messageId: row.id, at: row.at, head: head.replace(/\s+/g, " ").trim() }];
  });
}

export interface MemoryFileStat {
  path: string;
  mtimeMs: number;
  bytes: number;
}

/** Index one memory file (upsert keeps the rowid, so the update trigger
 * keeps the FTS rows in step — the same reasoning as UPSERT_MESSAGE). With
 * encryption on, the text is sealed under the bot's key and only its keyed
 * words reach the (blind) index. */
export function indexMemoryFile(botId: string, path: string, text: string, stat: { mtimeMs: number; bytes: number }): void {
  const key = contentKeyForBot(botId);
  const sealed = key ? seal(key.dek, text, memoryRowAad(key, botId, path)) : null;
  const row = db()
    .prepare(
      "INSERT INTO memory_files (bot_id, path, text, mtime_ms, bytes, sealed, key_id) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(bot_id, path) DO UPDATE SET text = excluded.text, mtime_ms = excluded.mtime_ms, bytes = excluded.bytes, " +
        "sealed = excluded.sealed, key_id = excluded.key_id RETURNING rowid",
    )
    .get(botId, path, key ? "" : text, Math.trunc(stat.mtimeMs), stat.bytes, sealed, key?.keyId ?? null) as { rowid: number } | undefined;
  // its keyed words just after, off the write (flushed before any recall)
  if (key && row) queueMemoryIndex(row.rowid, key, text);
  // written plain (the bot's key not available yet): the migration seals it
  else if (encryptionMode() === "on") { migration.dirty = true; scheduleMigration(); }
}

function memoryRowAad(key: LiveKey, botId: string, path: string): Buffer {
  return fieldAad(key.keyId, key.owner, "memory-file", `${botId}\u0000${path}`);
}

const pendingMemoryIndex = new Map<number, { keyId: string; text: string }>();
let memoryIndexTimer: ReturnType<typeof setImmediate> | null = null;
function queueMemoryIndex(rowid: number, key: LiveKey, text: string): void {
  pendingMemoryIndex.set(rowid, { keyId: key.keyId, text });
  memoryIndexTimer ??= setImmediate(() => { memoryIndexTimer = null; try { flushMemoryIndex(); } catch { /* the migration reindexes */ } });
}

/** Write the queued keyed words of memory rows (before a recall reads them). */
function flushMemoryIndex(): void {
  if (memoryIndexTimer) { clearImmediate(memoryIndexTimer); memoryIndexTimer = null; }
  if (!pendingMemoryIndex.size || !handle) { pendingMemoryIndex.clear(); return; }
  const entries = [...pendingMemoryIndex];
  pendingMemoryIndex.clear();
  transaction(() => {
    const check = cached("SELECT key_id, rowid IN (SELECT rowid FROM memory_sealed_fts WHERE rowid = ?) AS indexed FROM memory_files WHERE rowid = ?");
    for (const [rowid, entry] of entries) {
      const row = check.get(rowid, rowid) as { key_id: string | null; indexed: number } | undefined;
      if (!row || row.key_id !== entry.keyId || row.indexed) continue;
      const key = keyring().key(entry.keyId);
      if (!key || key === "destroyed") continue;
      indexMemoryRow(rowid, key, entry.text);
    }
  });
}

function indexMemoryRow(rowid: number, key: LiveKey, text: string): void {
  const columns = indexColumns(key.tokenizer(), { recall: text, search: null, tool: null });
  if (columns?.words) cached("INSERT INTO memory_sealed_fts (rowid, words, prefixes) VALUES (?, ?, ?)").run(rowid, columns.words, columns.prefixes);
}

/** The text of a sealed memory row. Null: its key was destroyed or the blob
 * does not open; throws ContentKeyUnavailable when its key is locked. */
function openMemoryRow(row: { bot_id: string; path: string; sealed: Uint8Array | null; key_id: string | null; text: string }): string | null {
  if (!row.sealed || !row.key_id) return row.text;
  const key = keyring().key(row.key_id);
  if (key === "destroyed") return null;
  if (!key) throw new ContentKeyUnavailable();
  try { return openText(key.dek, row.sealed, memoryRowAad(key, row.bot_id, row.path)); } catch { return null; }
}

export function removeMemoryFile(botId: string, path: string): void {
  db().prepare("DELETE FROM memory_files WHERE bot_id = ? AND path = ?").run(botId, path);
}

/** Remove one bot's memory-file rows. The delete trigger drops the
 * matching external-content FTS rows, the same way deleting a thread's
 * messages drops theirs. */
export function deleteBotMemoryFiles(botId: string): void {
  db().prepare("DELETE FROM memory_files WHERE bot_id = ?").run(botId);
}

/** What is indexed for a bot, so the caller can compare against the disk. */
export function indexedMemoryFiles(botId: string): MemoryFileStat[] {
  const rows = db()
    .prepare("SELECT path, mtime_ms, bytes FROM memory_files WHERE bot_id = ?")
    // SAFETY: the SELECT names exactly these three NOT NULL columns
    .all(botId) as Array<{ path: string; mtime_ms: number; bytes: number }>;
  return rows.map((row) => ({ path: row.path, mtimeMs: row.mtime_ms, bytes: row.bytes }));
}

export interface MemoryHit {
  /** workspace-relative: MEMORY.md, memory/<topic>.md, memory/log/<day>.md, or docs/<name>.md for a docs search */
  file: string;
  /** the matched passage, with each matched term wrapped in [brackets] */
  snippet: string;
  /** when the file was last written, from its mtime */
  at: number;
}

/** Relevance-ranked recall over ONE bot's memory files. Scoped by bot id
 * in SQL, the same way recallMessages scopes by thread: another bot's
 * memory is not a lower-ranked result, it is not a result. */
export function recallMemory(query: string, botId: string, limit = 12, mode: SearchMode = "all", scope: "memory" | "docs" = "memory"): MemoryHit[] {
  const match = ftsQuery(query, mode);
  if (!match) return [];
  // docs/ (server/workspace/workspace-files.ts) shares this index but is never
  // memory: session_search and automatic recall keep to memory files,
  // workspace_search keeps to docs.
  const scopeSql = (scope === "docs" ? "AND f.path LIKE 'docs/%' " : "AND f.path NOT LIKE 'docs/%' ") +
    // Automatic recall must filter before LIMIT; historical logs can
    // otherwise crowd all current topic files out of the result set.
    (mode === "any" ? "AND f.path NOT IN ('MEMORY.md', 'memory/archive.md') AND f.path NOT LIKE 'memory/log/%' " : "");
  const rows = db()
    .prepare(
      "SELECT f.path, f.mtime_ms, bm25(memory_fts) AS score, " +
        `snippet(memory_fts, 0, '[', ']', '…', ${SNIPPET_TOKENS}) AS snippet ` +
        "FROM memory_fts JOIN memory_files f ON f.rowid = memory_fts.rowid " +
        "WHERE memory_fts MATCH ? AND f.bot_id = ? " + scopeSql +
        "ORDER BY bm25(memory_fts), f.mtime_ms DESC LIMIT ?",
    )
    // SAFETY: the SELECT names exactly these four columns; snippet() is never null
    .all(match, botId, limit) as Array<{ path: string; mtime_ms: number; score: number; snippet: string }>;
  const hits = rows.map((row) => ({ file: row.path, at: row.mtime_ms, snippet: row.snippet.replace(/\s+/g, " ").trim(), score: row.score }));
  flushMemoryIndex();
  if (cached("SELECT 1 FROM memory_files WHERE bot_id = ? AND key_id IS NOT NULL LIMIT 1").get(botId)) {
    hits.push(...sealedMemoryRecall(query, botId, limit, mode, scopeSql));
    hits.sort((a, b) => a.score - b.score || b.at - a.at);
  }
  return hits.slice(0, limit).map(({ score: _score, ...hit }) => hit);
}

/** Recall over sealed memory rows: bm25 over keyed words, the match checked
 * and the snippet cut from the opened text (as sealedRecall does). */
function sealedMemoryRecall(query: string, botId: string, limit: number, mode: SearchMode, scopeSql: string): Array<MemoryHit & { score: number }> {
  const terms = blindRecallTerms(query, mode);
  const keyIds = (cached("SELECT DISTINCT key_id FROM memory_files WHERE bot_id = ? AND key_id IS NOT NULL").all(botId) as Array<{ key_id: string }>).map((row) => row.key_id);
  const keys = keyIds.map((id) => keyring().key(id)).filter((key): key is LiveKey => Boolean(key) && key !== "destroyed");
  const match = recallMatch(keys.map((key) => key.tokenizer()), terms, mode);
  if (!match) return [];
  const rows = db()
    .prepare(
      "SELECT f.bot_id, f.path, f.mtime_ms, f.text, f.sealed, f.key_id, bm25(memory_sealed_fts, 1.0, 0.5) AS score " +
        "FROM memory_sealed_fts JOIN memory_files f ON f.rowid = memory_sealed_fts.rowid " +
        "WHERE memory_sealed_fts MATCH ? AND f.bot_id = ? " + scopeSql +
        "ORDER BY score, f.mtime_ms DESC LIMIT ?",
    )
    // a superset (four-letter prefixes): read more, keep what the text holds
    .all(match, botId, limit * 4) as Array<{ bot_id: string; path: string; mtime_ms: number; text: string; sealed: Uint8Array | null; key_id: string | null; score: number }>;
  const out: Array<MemoryHit & { score: number }> = [];
  for (const row of rows) {
    const text = openMemoryRow(row);
    if (text === null || !recallHolds(text, terms, mode)) continue;
    if (out.length >= limit) break;
    out.push({ file: row.path, at: row.mtime_ms, snippet: blindSnippet(text, terms, SNIPPET_TOKENS).replace(/\s+/g, " ").trim(), score: row.score });
  }
  return out;
}

/** Await before maintenance replaces the database or shutdown releases its lease. */
export async function closeMessageSearch(): Promise<void> {
  const worker = searchWorker;
  searchWorker = null;
  if (worker) closingSearch = Promise.all([closingSearch, worker.close()]).then(() => {});
  await closingSearch;
}

/** Test/shutdown hook — closes the handle so a wiped DATA_DIR starts clean. */
export function closeMessageDb(): void {
  void closeMessageSearch().catch(reportBackgroundError);
  try { if (handle && handlePath === DB_FILE() && existsSync(DB_FILE())) { flushContentIndex(); flushMemoryIndex(); } } catch { /* a closing database: the migration reindexes what has no index row */ }
  if (migration.timer) { clearTimeout(migration.timer); migration.timer = null; }
  if (indexTimer) { clearTimeout(indexTimer); indexTimer = null; }
  forgetSealingState();
  try {
    handle?.close();
  } catch {}
  handle = null;
  handlePath = null;
  handleCheckedAt = 0;
}
