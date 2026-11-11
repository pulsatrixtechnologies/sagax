// Content keys (docs/content-encryption.md): one random content key (DEK)
// per owner, a person or the workspace, and one per confidential thread.
//
//   owner key            wrapped by the key-encryption key (KEK) of the
//                        configured provider: "local" (the vault key of
//                        mcp-oauth.enc: the OS keychain on the desktop, a
//                        0600 key file on a headless server) or
//                        "azure-keyvault" (wrapKey/unwrapKey, content-key-azure.ts)
//   confidential thread  wrapped by its owner's key (AES-256-GCM)
//
// Wrapped keys live in the content_keys table of messages.db. Destroying a
// key deletes its row with secure_delete on and checkpoints the WAL: every
// row sealed under it is unreadable from then on (cryptographic erasure).
// Unwrapped keys stay in memory only, for the life of the process.
import { createSecretKey, randomBytes, type KeyObject } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import { BlindTokenizer, deriveSubkey, keyAad, newContentKey, open, seal } from "./content-crypto.ts";
import type { VaultKeySource } from "../mcp/mcp-oauth.ts";
import { reportBackgroundError } from "../background-error.ts";

/** The owner of rooms, unowned threads and receipts. Never a principal id. */
export const WORKSPACE_OWNER = "@workspace";

export interface WrappedKey {
  provider: string;
  /** the provider's reference: the Key Vault key version (kid), "" locally */
  ref: string;
  wrapped: Buffer;
}

/** A key-encryption key. Local wrapping is synchronous; a remote provider
 * is asynchronous only, so its keys are unwrapped before the first read
 * (ContentKeyring.unlock) and created ahead of a write (ensureOwner). */
export interface KekProvider {
  readonly id: string;
  wrapSync?(dek: Buffer, aad: Buffer): WrappedKey;
  unwrapSync?(wrapped: WrappedKey, aad: Buffer): Buffer;
  wrap(dek: Buffer, aad: Buffer): Promise<WrappedKey>;
  unwrap(wrapped: WrappedKey, aad: Buffer): Promise<Buffer>;
}

export class ContentKeyUnavailable extends Error {
  readonly status = 503;
  constructor(message = "The content encryption key is not available on this launch.") {
    super(message);
  }
}

/** The vault key's own derivation, distinct from every other use of it. */
export function localKekProvider(source: () => VaultKeySource): KekProvider {
  let kek: Buffer | null = null;
  const key = (): Buffer => {
    if (kek) return kek;
    const resolved = source();
    if (resolved.kind !== "key") throw new ContentKeyUnavailable();
    kek = deriveSubkey(resolved.key, "sagax content kek v1");
    return kek;
  };
  const provider: KekProvider = {
    id: "local",
    wrapSync: (dek, aad) => ({ provider: "local", ref: "", wrapped: seal(key(), dek, aad) }),
    unwrapSync: (wrapped, aad) => open(key(), wrapped.wrapped, aad),
    wrap: async (dek, aad) => provider.wrapSync!(dek, aad),
    unwrap: async (wrapped, aad) => provider.unwrapSync!(wrapped, aad),
  };
  return provider;
}

export interface LiveKey {
  keyId: string;
  owner: string;
  threadId: string | null;
  /** AES-256-GCM key object: importing raw bytes per call costs more */
  dek: KeyObject;
  raw: Buffer;
  tokenizer(): BlindTokenizer;
}

interface KeyRow {
  key_id: string;
  owner: string;
  thread_id: string | null;
  parent_id: string | null;
  provider: string;
  ref: string;
  wrapped: Uint8Array;
}

export function ensureContentKeySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_keys (
      key_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      thread_id TEXT,
      parent_id TEXT,
      provider TEXT NOT NULL,
      ref TEXT NOT NULL DEFAULT '',
      wrapped BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS content_keys_owner ON content_keys(owner) WHERE thread_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS content_keys_thread ON content_keys(thread_id) WHERE thread_id IS NOT NULL;
    -- Keys wrapped by a vault key that "Reset saved keys" dropped (retireLocalContentKeys): kept, never deleted, so
    -- what they sealed opens again if the old credential file is put back; no longer an owner's or a thread's key.
    CREATE TABLE IF NOT EXISTS content_keys_retired (
      key_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      thread_id TEXT,
      parent_id TEXT,
      provider TEXT NOT NULL,
      ref TEXT NOT NULL DEFAULT '',
      wrapped BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      retired_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS content_keys_retired_owner ON content_keys_retired(owner);
  `);
}

/** After "Reset saved keys" (server/vault/vault-key-reset.ts) the vault key is new, so the keys the local provider
 * wrapped with the old one never unwrap again. Left in content_keys, an owner would keep that key forever (one owner
 * row, content_keys_owner) and every new row would be written plain. They move, with the thread keys chained under
 * them, to content_keys_retired: ownerKey() then makes fresh keys under the new vault key, and what the old keys
 * sealed reports locked (ContentKeyUnavailable), never erased. Only keys made before `madeBefore` (the reset, in ms).
 * Returns the keys moved. */
export function retireLocalContentKeys(db: DatabaseSync, resetAt: string, madeBefore: number): number {
  ensureContentKeySchema(db);
  // only keys made before the reset: one the new vault key wrapped stays
  const ids = new Set((db.prepare("SELECT key_id FROM content_keys WHERE provider = 'local' AND parent_id IS NULL AND created_at < ?").all(madeBefore) as Array<{ key_id: string }>).map((row) => row.key_id));
  if (!ids.size) return 0;
  const children = db.prepare("SELECT key_id FROM content_keys WHERE parent_id = ?");
  for (let frontier = [...ids]; frontier.length;) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const { key_id } of children.all(parent) as Array<{ key_id: string }>) if (!ids.has(key_id)) { ids.add(key_id); next.push(key_id); }
    }
    frontier = next;
  }
  const hasBindings = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_keys'").get());
  const keep = db.prepare(`INSERT OR IGNORE INTO content_keys_retired (key_id, owner, thread_id, parent_id, provider, ref, wrapped, created_at, retired_at)
    SELECT key_id, owner, thread_id, parent_id, provider, ref, wrapped, created_at, ? FROM content_keys WHERE key_id = ?`);
  const unbind = hasBindings ? db.prepare("DELETE FROM thread_keys WHERE key_id = ?") : null;
  const drop = db.prepare("DELETE FROM content_keys WHERE key_id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const keyId of ids) {
      keep.run(resetAt, keyId);
      unbind?.run(keyId);
      drop.run(keyId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return ids.size;
}

function live(row: { key_id: string; owner: string; thread_id: string | null }, raw: Buffer): LiveKey {
  let tokenizer: BlindTokenizer | null = null;
  return {
    keyId: row.key_id,
    owner: row.owner,
    threadId: row.thread_id,
    dek: createSecretKey(raw),
    raw,
    tokenizer: () => (tokenizer ??= new BlindTokenizer(deriveSubkey(raw, "sagax content index v1"))),
  };
}

/** Keys unwrapped between two turns of the event loop in unlock(). */
export const UNLOCK_BATCH = 32;
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export class ContentKeyring {
  private readonly database: () => DatabaseSync;
  private readonly active: KekProvider;
  private readonly providers: Map<string, KekProvider>;
  private readonly cache = new Map<string, LiveKey>();
  private readonly creating = new Map<string, Promise<void>>();
  private readonly statements = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
  private readonly onReady: () => void;

  constructor(database: () => DatabaseSync, active: KekProvider, others: readonly KekProvider[] = [], onReady: () => void = () => {}) {
    this.database = database;
    this.active = active;
    this.providers = new Map([...others, active].map((provider) => [provider.id, provider]));
    this.onReady = onReady;
  }

  get providerId(): string {
    return this.active.id;
  }

  /** Forget every unwrapped key (the database was replaced or closed). */
  reset(): void {
    this.cache.clear();
  }

  /** A statement prepared once per database handle: a key lookup runs per
   * key at start and per sealed row read. */
  private statement(sql: string): StatementSync {
    const database = this.database();
    let byDatabase = this.statements.get(database);
    if (!byDatabase) this.statements.set(database, (byDatabase = new Map()));
    let statement = byDatabase.get(sql);
    if (!statement) byDatabase.set(sql, (statement = database.prepare(sql)));
    return statement;
  }

  private row(where: string, value: string): KeyRow | undefined {
    return this.statement(`SELECT key_id, owner, thread_id, parent_id, provider, ref, wrapped FROM content_keys WHERE ${where}`).get(value) as KeyRow | undefined;
  }

  /** A key a reset retired: it still exists (locked, not erased). */
  private retiredRow(keyId: string): KeyRow | undefined {
    return this.statement("SELECT key_id, owner, thread_id, parent_id, provider, ref, wrapped FROM content_keys_retired WHERE key_id = ?").get(keyId) as KeyRow | undefined;
  }

  /** "destroyed": no such key any more (its rows are erased); null: it
   * exists but cannot be unwrapped synchronously on this launch. */
  key(keyId: string): LiveKey | "destroyed" | null {
    const cached = this.cache.get(keyId);
    if (cached) return cached;
    const row = this.row("key_id = ?", keyId) ?? this.retiredRow(keyId);
    if (!row) return "destroyed";
    return this.unwrapSync(row);
  }

  private unwrapSync(row: KeyRow): LiveKey | null {
    const aad = keyAad(row.key_id, row.owner, row.thread_id);
    let raw: Buffer;
    if (row.parent_id) {
      const parent = this.key(row.parent_id);
      if (!parent || parent === "destroyed") return null;
      raw = open(parent.raw, row.wrapped, aad);
    } else {
      const provider = this.providers.get(row.provider);
      if (!provider?.unwrapSync) return null;
      try { raw = provider.unwrapSync({ provider: row.provider, ref: row.ref, wrapped: Buffer.from(row.wrapped) }, aad); }
      catch { return null; }
    }
    const key = live(row, raw);
    this.cache.set(row.key_id, key);
    return key;
  }

  /** The owner's key, created on first use when the provider can wrap
   * synchronously. Null while a remote provider is still creating it. */
  ownerKey(owner: string): LiveKey | null {
    const row = this.row("owner = ? AND thread_id IS NULL", owner);
    if (row) {
      const cached = this.cache.get(row.key_id);
      return cached ?? this.unwrapSync(row);
    }
    if (!this.active.wrapSync) {
      void this.ensureOwner(owner).catch(reportBackgroundError);
      return null;
    }
    const keyId = randomBytes(8).toString("hex");
    const dek = newContentKey();
    let wrapped: WrappedKey;
    try { wrapped = this.active.wrapSync(dek, keyAad(keyId, owner, null)); }
    catch { return null; }
    this.insert({ key_id: keyId, owner, thread_id: null, parent_id: null, ...this.columns(wrapped) });
    const key = live({ key_id: keyId, owner, thread_id: null }, dek);
    this.cache.set(keyId, key);
    return key;
  }

  /** Create an owner's key with an asynchronous provider. */
  ensureOwner(owner: string): Promise<void> {
    const pending = this.creating.get(owner);
    if (pending) return pending;
    const run = (async () => {
      if (this.row("owner = ? AND thread_id IS NULL", owner)) return;
      const keyId = randomBytes(8).toString("hex");
      const dek = newContentKey();
      const wrapped = await this.active.wrap(dek, keyAad(keyId, owner, null));
      if (this.row("owner = ? AND thread_id IS NULL", owner)) return;
      this.insert({ key_id: keyId, owner, thread_id: null, parent_id: null, ...this.columns(wrapped) });
      this.cache.set(keyId, live({ key_id: keyId, owner, thread_id: null }, dek));
      this.onReady();
    })().catch(() => { /* retried by the next write or migration pass */ }).finally(() => this.creating.delete(owner));
    this.creating.set(owner, run);
    return run;
  }

  /** A confidential thread's own key, wrapped under its owner's. */
  threadKey(owner: string, threadId: string): LiveKey | null {
    const row = this.row("thread_id = ?", threadId);
    // A thread keeps the key it was given, under the owner it had then: the
    // key's own owner is what its rows' additional data names.
    if (row) return this.cache.get(row.key_id) ?? this.unwrapSync(row);
    const parent = this.ownerKey(owner);
    if (!parent) return null;
    const keyId = randomBytes(8).toString("hex");
    const dek = newContentKey();
    this.insert({ key_id: keyId, owner, thread_id: threadId, parent_id: parent.keyId, provider: "parent", ref: "", wrapped: seal(parent.raw, dek, keyAad(keyId, owner, threadId)) });
    const key = live({ key_id: keyId, owner, thread_id: threadId }, dek);
    this.cache.set(keyId, key);
    return key;
  }

  private columns(wrapped: WrappedKey): { provider: string; ref: string; wrapped: Buffer } {
    return { provider: wrapped.provider, ref: wrapped.ref, wrapped: wrapped.wrapped };
  }

  private insert(row: KeyRow): void {
    this.database()
      .prepare("INSERT INTO content_keys (key_id, owner, thread_id, parent_id, provider, ref, wrapped, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.key_id, row.owner, row.thread_id, row.parent_id, row.provider, row.ref, row.wrapped, Date.now());
  }

  /** Unwrap every stored key ahead of the first read (an asynchronous
   * provider), and re-wrap the keys a previous provider wrapped under the
   * active one (switching local to Key Vault, or back). A local provider
   * unwraps synchronously, so its promises never give the loop back: the
   * pass yields every UNLOCK_BATCH keys, or a server with many owners and
   * confidential threads stops its loop for seconds at start (#3524). */
  async unlock(): Promise<{ unlocked: number; failed: number; rewrapped: number }> {
    const rows = this.database().prepare("SELECT key_id, owner, thread_id, parent_id, provider, ref, wrapped FROM content_keys WHERE parent_id IS NULL").all() as unknown as KeyRow[];
    let unlocked = 0, failed = 0, rewrapped = 0;
    let done = 0;
    for (const row of rows) {
      if (done++ % UNLOCK_BATCH === UNLOCK_BATCH - 1) await yieldToLoop();
      const aad = keyAad(row.key_id, row.owner, row.thread_id);
      let raw = this.cache.get(row.key_id)?.raw;
      if (!raw) {
        const provider = this.providers.get(row.provider);
        if (!provider) { failed++; continue; }
        try { raw = await provider.unwrap({ provider: row.provider, ref: row.ref, wrapped: Buffer.from(row.wrapped) }, aad); }
        catch { failed++; continue; }
        this.cache.set(row.key_id, live(row, raw));
      }
      unlocked++;
      if (row.provider !== this.active.id) {
        try {
          const wrapped = await this.active.wrap(raw, aad);
          this.database().prepare("UPDATE content_keys SET provider = ?, ref = ?, wrapped = ? WHERE key_id = ?").run(wrapped.provider, wrapped.ref, wrapped.wrapped, row.key_id);
          rewrapped++;
        } catch { /* stays under its old provider, still readable */ }
      }
    }
    // thread keys open from their parents synchronously
    for (const row of this.database().prepare("SELECT key_id FROM content_keys WHERE parent_id IS NOT NULL").all() as Array<{ key_id: string }>) {
      if (done++ % UNLOCK_BATCH === UNLOCK_BATCH - 1) await yieldToLoop();
      this.key(row.key_id);
    }
    if (unlocked) this.onReady();
    return { unlocked, failed, rewrapped };
  }

  /** Key ids of an owner: their own key and every thread key under it. */
  ownerKeyIds(owner: string): string[] {
    // a retired key is still the owner's: erasing the owner erases it too
    return (this.database().prepare("SELECT key_id FROM content_keys WHERE owner = ? UNION SELECT key_id FROM content_keys_retired WHERE owner = ?").all(owner, owner) as Array<{ key_id: string }>).map((row) => row.key_id);
  }

  threadKeyId(threadId: string): string | null {
    return this.row("thread_id = ?", threadId)?.key_id ?? null;
  }

  /** Delete keys for good. secure_delete zeroes their cells, and the WAL
   * checkpoint drops the copies a write-ahead log still held. */
  destroyKeys(keyIds: readonly string[]): void {
    if (!keyIds.length) return;
    const db = this.database();
    db.exec("PRAGMA secure_delete = ON");
    try {
      const remove = db.prepare("DELETE FROM content_keys WHERE key_id = ? OR parent_id = ?");
      const removeRetired = db.prepare("DELETE FROM content_keys_retired WHERE key_id = ? OR parent_id = ?");
      for (const keyId of keyIds) { remove.run(keyId, keyId); removeRetired.run(keyId, keyId); }
      const gone = new Set(keyIds);
      // and the thread keys that were wrapped under a destroyed owner key
      for (const [id, key] of this.cache) if (gone.has(id) || (key.threadId !== null && !this.row("key_id = ?", id))) this.cache.delete(id);
    } finally { db.exec("PRAGMA secure_delete = OFF"); }
  }

  /** Every key that opens on this launch (unwrapped on demand), for the
   * search and a backup. Locked keys are left out. */
  liveKeys(): LiveKey[] {
    const ids = this.database().prepare("SELECT key_id FROM content_keys ORDER BY parent_id IS NOT NULL").all() as Array<{ key_id: string }>;
    const out: LiveKey[] = [];
    for (const { key_id } of ids) {
      const key = this.key(key_id);
      if (key && key !== "destroyed") out.push(key);
    }
    return out;
  }

  /** Keys that exist but do not open on this launch. */
  lockedCount(): number {
    let locked = 0;
    for (const { key_id } of this.database().prepare("SELECT key_id FROM content_keys UNION SELECT key_id FROM content_keys_retired").all() as Array<{ key_id: string }>) if (this.key(key_id) === null) locked++;
    return locked;
  }

  /** Keys that exist (unwrapped or not). */
  count(): number {
    return (this.database().prepare("SELECT COUNT(*) AS n FROM content_keys").get() as { n: number }).n;
  }
}
